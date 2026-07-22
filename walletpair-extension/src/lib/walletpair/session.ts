import { x25519 } from '@noble/curves/ed25519.js';
import {
  ChannelCipher,
  CounterPersistenceError,
  computeDappPairingCode,
  createChannelCipher,
  decodeStoredSecretKey,
  generateX25519KeyPair,
  type CipherCounters,
} from './crypto';
import { bytesToBase64Url, bytesToHex, randomBytes } from './encoding';
import {
  classifyEthereumMessage,
  createEthereumRequest,
  ProviderRpcError,
  type EthereumEvent,
  type EthereumRequest,
} from './ethereum';
import {
  buildPairingUri,
  buildRelayConnectionUrl,
  parseChannelJoined,
  type ParticipantMeta,
  type RelayIdentity,
  validateChannelId,
  validateParticipantMeta,
  validatePublicKey,
  validateRelayUrl,
} from './relay';

export type SessionPhase = 'idle' | 'waiting' | 'connected' | 'disconnected' | 'closed';

export interface WalletMeta extends ParticipantMeta {
  pubkey: string;
}

export interface WalletPairSessionOptions {
  relayUrl: string;
  meta: ParticipantMeta;
  requestTimeout?: number;
  persist?: (serialized: string) => Promise<void>;
  webSocketFactory?: (url: string) => WebSocket;
  connectTimeout?: number;
}

interface SessionSnapshot {
  v: 1;
  role: 'dapp';
  relayUrl: string;
  meta: ParticipantMeta;
  ch: string;
  secretKey: string;
  pubkey: string;
  wallet: WalletMeta | null;
  sendSequence: number;
  receiveSequence: number;
}

interface PendingRequest {
  caip2: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type Listener = (...args: any[]) => void;

export class WalletPairSession {
  phase: SessionPhase = 'idle';
  pairingUri?: string;
  pairingCode?: string;

  private relayUrl: string;
  private meta: ParticipantMeta;
  private readonly requestTimeout: number;
  private readonly connectTimeout: number;
  private readonly persistCallback: (serialized: string) => Promise<void>;
  private readonly webSocketFactory: (url: string) => WebSocket;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly pending = new Map<string, PendingRequest>();
  private socket: WebSocket | null = null;
  private channelId?: string;
  private secretKey?: Uint8Array;
  private publicKey?: string;
  private pinnedWallet: WalletMeta | null = null;
  private cipher: ChannelCipher | null = null;
  private ownJoinReceived = false;
  private intentionalClose = false;
  private requestCounter = 0;
  private sendTail: Promise<void> = Promise.resolve();
  private receiveTail: Promise<void> = Promise.resolve();
  private persistTail: Promise<void> = Promise.resolve();
  private persistenceFailure: CounterPersistenceError | null = null;

  constructor(options: WalletPairSessionOptions) {
    validateRelayUrl(options.relayUrl);
    validateParticipantMeta(options.meta);
    this.relayUrl = options.relayUrl;
    this.meta = { ...options.meta };
    this.requestTimeout = options.requestTimeout ?? 60_000;
    this.connectTimeout = options.connectTimeout ?? 10_000;
    this.persistCallback = options.persist ?? (async () => {});
    this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
  }

  get walletMeta(): WalletMeta | undefined {
    return this.pinnedWallet ? { ...this.pinnedWallet } : undefined;
  }

  on(event: string, listener: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return this;
  }

  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  async createPairing(): Promise<void> {
    this.releaseSecrets();
    const keyPair = generateX25519KeyPair();
    this.channelId = bytesToHex(randomBytes(32));
    this.secretKey = keyPair.secretKey;
    this.publicKey = keyPair.publicKeyBase64Url;
    this.pinnedWallet = null;
    this.pairingUri = buildPairingUri(this.relayUrl, this.identity());
    this.pairingCode = computeDappPairingCode(this.channelId, this.meta, this.publicKey);
    this.intentionalClose = false;
    this.setPhase('waiting');
    this.emit('sessionFingerprint', this.pairingCode);
    try {
      await this.persist();
    } catch (error) {
      this.close();
      throw error;
    }
    await this.connect();
  }

  restore(serialized: string): boolean {
    try {
      const snapshot = JSON.parse(serialized) as Partial<SessionSnapshot>;
      if (snapshot.v !== 1 || snapshot.role !== 'dapp') throw new TypeError('unsupported session snapshot');
      if (typeof snapshot.relayUrl !== 'string') throw new TypeError('missing relay URL');
      if (!isParticipantMeta(snapshot.meta)) throw new TypeError('invalid DApp metadata');
      if (typeof snapshot.ch !== 'string' || typeof snapshot.secretKey !== 'string' || typeof snapshot.pubkey !== 'string') {
        throw new TypeError('invalid session key data');
      }
      validateRelayUrl(snapshot.relayUrl);
      validateParticipantMeta(snapshot.meta);
      validateChannelId(snapshot.ch);
      validatePublicKey(snapshot.pubkey);
      const secretKey = decodeStoredSecretKey(snapshot.secretKey);
      if (bytesToBase64Url(x25519.getPublicKey(secretKey)) !== snapshot.pubkey) {
        throw new TypeError('stored X25519 key pair does not match');
      }
      const counters: CipherCounters = {
        sendSequence: snapshot.sendSequence as number,
        receiveSequence: snapshot.receiveSequence as number,
      };
      let wallet: WalletMeta | null = null;
      if (snapshot.wallet !== null && snapshot.wallet !== undefined) {
        if (!isWalletMeta(snapshot.wallet)) throw new TypeError('invalid stored Wallet identity');
        validateParticipantMeta(snapshot.wallet);
        validatePublicKey(snapshot.wallet.pubkey);
        wallet = { ...snapshot.wallet };
      }

      this.releaseSecrets();
      this.relayUrl = snapshot.relayUrl;
      this.meta = { ...snapshot.meta };
      this.channelId = snapshot.ch;
      this.secretKey = secretKey;
      this.publicKey = snapshot.pubkey;
      this.pinnedWallet = wallet;
      this.pairingUri = buildPairingUri(this.relayUrl, this.identity());
      this.pairingCode = computeDappPairingCode(this.channelId, this.meta, this.publicKey);
      if (wallet) {
        this.cipher = createChannelCipher(
          this.channelId,
          'dapp',
          this.secretKey,
          this.publicKey,
          wallet.pubkey,
          counters,
        );
      } else if (counters.sendSequence !== 0 || counters.receiveSequence !== -1) {
        throw new TypeError('unpaired session cannot have traffic counters');
      }
      this.intentionalClose = false;
      this.setPhase('disconnected');
      this.emit('sessionFingerprint', this.pairingCode);
      return true;
    } catch {
      this.releaseSecrets();
      this.channelId = undefined;
      this.publicKey = undefined;
      this.pinnedWallet = null;
      this.pairingUri = undefined;
      this.pairingCode = undefined;
      this.phase = 'idle';
      return false;
    }
  }

  async reconnect(): Promise<void> {
    if (!this.channelId || !this.secretKey || !this.publicKey) throw new Error('no session to reconnect');
    this.intentionalClose = false;
    this.setPhase(this.pinnedWallet ? 'disconnected' : 'waiting');
    await this.connect();
  }

  async request(args: { method: string; params?: unknown }, caip2: string): Promise<unknown> {
    if (this.phase !== 'connected' || !this.cipher || !this.socket || this.socket.readyState !== 1) {
      throw new ProviderRpcError(4900, 'WalletPair channel is disconnected');
    }
    if (this.pending.size >= 1024) throw new ProviderRpcError(-32005, 'Too many outstanding requests');
    const id = `req-${Date.now().toString(36)}-${(++this.requestCounter).toString(36)}-${bytesToBase64Url(randomBytes(6))}`;
    const request = createEthereumRequest(id, args.method, args.params);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new ProviderRpcError(-32603, 'Wallet request timed out'));
      }, this.requestTimeout);
      this.pending.set(id, { caip2, resolve, reject, timer });
      this.enqueueSend(request, caip2).catch((error) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  serialize(): string {
    if (!this.channelId || !this.secretKey || !this.publicKey) throw new Error('session has not been created');
    const counters = this.cipher?.counters() ?? { sendSequence: 0, receiveSequence: -1 };
    const snapshot: SessionSnapshot = {
      v: 1,
      role: 'dapp',
      relayUrl: this.relayUrl,
      meta: { ...this.meta },
      ch: this.channelId,
      secretKey: bytesToBase64Url(this.secretKey),
      pubkey: this.publicKey,
      wallet: this.pinnedWallet ? { ...this.pinnedWallet } : null,
      ...counters,
    };
    return JSON.stringify(snapshot);
  }

  ping(caip2: string): void {
    // Browser WebSocket exposes no control-frame ping API. A protocol-valid,
    // encrypted read request creates traffic without adding a plaintext frame.
    if (this.phase !== 'connected' || this.socket?.readyState !== 1) return;
    this.request({ method: 'eth_chainId' }, caip2).catch(() => {});
  }

  close(): void {
    if (this.phase === 'closed') return;
    this.intentionalClose = true;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === 0 || socket.readyState === 1) socket.close(1000, 'normal');
    }
    this.rejectPending(new ProviderRpcError(4900, 'WalletPair channel closed'));
    this.releaseSecrets();
    this.channelId = undefined;
    this.publicKey = undefined;
    this.pinnedWallet = null;
    this.pairingUri = undefined;
    this.pairingCode = undefined;
    this.ownJoinReceived = false;
    this.setPhase('closed');
  }

  /** Close the channel and wait until no queued operation can persist again. */
  async closeAndDrain(): Promise<void> {
    this.close();
    await Promise.all([this.sendTail, this.receiveTail]);
    // A send/receive task may have appended a persistence write while draining.
    await this.persistTail;
  }

  destroy(): void {
    this.close();
    this.listeners.clear();
  }

  private async connect(): Promise<void> {
    const identity = this.identity();
    this.detachSocket();
    this.ownJoinReceived = false;
    const socket = this.webSocketFactory(buildRelayConnectionUrl(this.relayUrl, identity));
    this.socket = socket;
    socket.binaryType = 'arraybuffer';

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new Error('relay connection timed out'));
      }, this.connectTimeout);
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      socket.onopen = () => {
        if (socket !== this.socket) return;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      };
      socket.onerror = () => fail(new Error('relay WebSocket failed'));
      socket.onclose = (event) => {
        if (!settled) fail(new Error(`relay WebSocket closed (${event.code})`));
        this.handleSocketClose(socket, event);
      };
      socket.onmessage = (event) => {
        if (socket !== this.socket || typeof event.data !== 'string') return;
        this.receiveTail = this.receiveTail
          .then(() => this.handleTextFrame(event.data as string))
          .catch((error) => this.emit('protocolError', error));
      };
    });
  }

  private async handleTextFrame(text: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const joined = parseChannelJoined(parsed);
    if (joined) {
      if (joined.ch !== this.channelId) return;
      if (joined.pubkey === this.publicKey) {
        this.ownJoinReceived = true;
        if (this.pinnedWallet && this.cipher) this.setPhase('connected');
        return;
      }
      if (!this.ownJoinReceived || this.pinnedWallet || !this.secretKey || !this.publicKey || !this.channelId) return;

      // The DApp deliberately pins only the first eligible joiner.
      this.pinnedWallet = { name: joined.name, url: joined.url, icon: joined.icon, pubkey: joined.pubkey };
      this.cipher = createChannelCipher(
        this.channelId,
        'dapp',
        this.secretKey,
        this.publicKey,
        joined.pubkey,
      );
      try {
        await this.persist();
      } catch (error) {
        this.close();
        throw error;
      }
      this.emit('walletJoined', { meta: { ...this.pinnedWallet } });
      this.setPhase('connected');
      return;
    }

    if (!this.cipher || this.phase !== 'connected') return;
    let opened;
    try {
      opened = await this.cipher.open(text, () => this.persist());
    } catch (error) {
      if (error instanceof CounterPersistenceError) this.close();
      // Invalid frames may come from extra relay participants. They are ignored
      // without advancing receive state, as required by the protocol.
      return;
    }
    if (!opened.caip2.startsWith('eip155:')) return;
    const classified = classifyEthereumMessage(opened.value);
    if (classified.kind === 'request') return; // Requests do not flow Wallet -> DApp.
    if (classified.kind === 'event') {
      if (!eventMatchesChain(classified.message, opened.caip2)) return;
      this.emit('ethereumEvent', classified.message, opened.caip2);
      return;
    }

    const pending = this.pending.get(classified.message.id);
    if (!pending) return;
    this.pending.delete(classified.message.id);
    clearTimeout(pending.timer);
    if (pending.caip2 !== opened.caip2) {
      pending.reject(new ProviderRpcError(-32600, 'Wallet response used a different chain context'));
      return;
    }
    if ('error' in classified.message) {
      pending.reject(new ProviderRpcError(
        classified.message.error.code,
        classified.message.error.message,
        classified.message.error.data,
      ));
    } else {
      pending.resolve(classified.message.result);
    }
  }

  private enqueueSend(message: EthereumRequest, caip2: string): Promise<void> {
    const task = this.sendTail.then(async () => {
      if (!this.cipher || !this.socket || this.socket.readyState !== 1) {
        throw new ProviderRpcError(4900, 'WalletPair channel is disconnected');
      }
      let frame: string;
      try {
        frame = await this.cipher.seal(message, caip2, () => this.persist());
      } catch (error) {
        if (error instanceof CounterPersistenceError) this.close();
        throw error;
      }
      if (!this.socket || this.socket.readyState !== 1) {
        throw new ProviderRpcError(4900, 'WalletPair channel disconnected before send');
      }
      this.socket.send(frame);
    });
    this.sendTail = task.catch(() => {});
    return task;
  }

  private identity(): RelayIdentity {
    if (!this.channelId || !this.publicKey) throw new Error('session identity is unavailable');
    return { ch: this.channelId, pubkey: this.publicKey, ...this.meta };
  }

  private async persist(): Promise<void> {
    if (this.persistenceFailure) throw this.persistenceFailure;
    const snapshot = this.serialize();
    const write = this.persistTail.then(async () => {
      if (this.persistenceFailure) throw this.persistenceFailure;
      try {
        await this.persistCallback(snapshot);
      } catch (error) {
        this.persistenceFailure = error instanceof CounterPersistenceError
          ? error
          : new CounterPersistenceError(error);
        throw this.persistenceFailure;
      }
    });
    this.persistTail = write.catch(() => {});
    await write;
  }

  private setPhase(phase: SessionPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.emit('phase', phase);
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      try { listener(...args); } catch { /* listener failures do not break the session */ }
    }
  }

  private handleSocketClose(socket: WebSocket, event: CloseEvent): void {
    if (socket !== this.socket) return;
    this.socket = null;
    this.ownJoinReceived = false;
    this.rejectPending(new ProviderRpcError(4900, `Relay disconnected (${event.code})`));
    if (!this.intentionalClose && this.phase !== 'closed') this.setPhase('disconnected');
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private detachSocket(): void {
    const old = this.socket;
    this.socket = null;
    if (!old) return;
    old.onopen = null;
    old.onmessage = null;
    old.onerror = null;
    old.onclose = null;
    if (old.readyState === 0 || old.readyState === 1) old.close(1000, 'replaced');
  }

  private releaseSecrets(): void {
    this.cipher?.destroy();
    this.cipher = null;
    this.secretKey?.fill(0);
    this.secretKey = undefined;
  }
}

function isParticipantMeta(value: unknown): value is ParticipantMeta {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === 'string' && typeof record.url === 'string' && typeof record.icon === 'string';
}

function isWalletMeta(value: unknown): value is WalletMeta {
  return isParticipantMeta(value) && typeof (value as unknown as Record<string, unknown>).pubkey === 'string';
}

export type { EthereumEvent };

function eventMatchesChain(event: EthereumEvent, caip2: string): boolean {
  const reference = caip2.slice('eip155:'.length);
  if (event.event === 'chainChanged') {
    return typeof event.data === 'string' && quantityToDecimal(event.data) === reference;
  }
  if (event.event === 'connect') {
    const data = event.data;
    if (!isJsonRecord(data)) return false;
    const record = data as Record<string, any>;
    if (typeof record.chainId !== 'string') return false;
    return quantityToDecimal(record.chainId) === reference;
  }
  if (event.event === 'accountsChanged') {
    return Array.isArray(event.data)
      && event.data.every((address) => typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address));
  }
  if (event.event === 'disconnect') {
    const data = event.data;
    if (!isJsonRecord(data)) return false;
    const record = data as Record<string, any>;
    return Number.isInteger(record.code) && typeof record.message === 'string';
  }
  const data = event.data;
  if (!isJsonRecord(data)) return false;
  const record = data as Record<string, any>;
  return typeof record.type === 'string' && 'data' in record;
}

function quantityToDecimal(value: string): string | null {
  if (!/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)) return null;
  return BigInt(value).toString(10);
}

function isJsonRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
