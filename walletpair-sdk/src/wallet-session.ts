/**
 * Wallet-side WalletPair session.
 *
 * Manages: parse URI → join → connected → handle requests → push events.
 */

import type { SessionCryptoContext } from './crypto.js'
import {
  b64urlDecode,
  b64urlEncode,
  bytesToHex,
  canonicalJson,
  computeSessionFingerprint,
  computeSharedSecret,
  constantTimeEqual,
  deriveDirectionalSessionKeys,
  deriveJoinEncryptionKey,
  deriveSessionKey,
  generateX25519KeyPair,
  hexToBytes,
  parsePairingUri,
  sealJoin,
  sealPayload,
  sha256Hex,
  signSnapshot,
  unsealPayload,
  verifySnapshot,
} from './crypto.js'
import { recordDisconnect } from './disconnect-log.js'
import { Emitter } from './emitter.js'
import type {
  Capabilities,
  ProtocolMessage,
  SessionPersistence,
  Transport,
  TransportCloseInfo,
  WalletMeta,
  WalletPhase,
  WalletSessionEvents,
  WalletSessionOptions,
} from './types.js'
import { isRecoverableCloseReason } from './types.js'

const BACKOFF = [1000, 2000, 5000, 10000, 30000]
const DEFAULT_HEARTBEAT_INTERVAL = 20_000
const DEFAULT_HEARTBEAT_TIMEOUT = 10_000
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10
const DEFAULT_MAX_RECONNECT_DURATION = 300_000
const MAX_SEND_SEQ = 2 ** 31
const MAX_PENDING_REQUESTS = 32 // §15 rule 11
const MAX_MESSAGE_BYTES = 65536 // §15 rule 10: 64 KB
const DEFAULT_SESSION_TTL = 24 * 60 * 60 * 1000 // 24 hours (§16 rule 16)
const IDEMPOTENCY_CACHE_LIMIT = 1024
const IDEMPOTENCY_RESPONSE_LIMIT_BYTES = 16 * 1024
const BROADCAST_CACHE_LIMIT = 256

function isPromiseLike<T = unknown>(value: unknown): value is Promise<T> {
  return !!value && typeof (value as Promise<T>).then === 'function'
}

/** No-op used to attach handlers that keep the persistence save-chain alive. */
const NOOP = (): void => {}

interface PendingRequestRecord {
  paramsHash: string
  method: string
}

interface CachedRequestResponse extends PendingRequestRecord {
  ok: boolean
  data: unknown
  tooLarge: boolean
}

export class WalletSession extends Emitter<WalletSessionEvents> {
  phase: WalletPhase = 'idle'

  /** Channel ID (hex). Available after join. */
  channelId = ''
  /** 4-digit session fingerprint. Available after prepareJoin(). */
  sessionFingerprint = ''

  private transport: Transport
  private capabilities: Capabilities
  private meta: WalletMeta | undefined

  private privKey!: Uint8Array
  private pubKeyB64 = ''
  private remotePubKey: Uint8Array | null = null
  private sessionKey: Uint8Array | null = null
  private sendKey: Uint8Array | null = null
  private recvKey: Uint8Array | null = null
  private sendSeq = 0
  private recvSeq = -1
  private relayUrl = ''
  private dappName: string | undefined
  private intentionalClose = false
  private evtCounter = 0
  /** dApp-declared method scope from pairing URI (§9.1 / §8.1). */
  private dappDeclaredMethods: string[] | undefined
  /** dApp-declared chain scope from pairing URI (§9.1 / §8.1). */
  private dappDeclaredChains: string[] | undefined
  /** Effective capabilities after scope intersection (§8.1). */
  private effectiveCapabilities!: Capabilities
  /** Session TTL in ms (§16 rule 16). */
  private sessionTtl: number
  private sessionTtlTimer: ReturnType<typeof setTimeout> | null = null
  private sessionStartTime: number | null = null
  private heartbeatInterval: number
  private heartbeatTimeout: number
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private livenessTimer: ReturnType<typeof setTimeout> | null = null

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  /** True while an auto-reconnect cycle is in progress; cleared on a successful
   * reconnect. Drives the backoff-preservation race fix. */
  private reconnecting = false
  /** Epoch ms when the current reconnect streak began (0 = not reconnecting). */
  private reconnectStartedAt = 0
  private maxReconnectAttempts: number
  private maxReconnectDurationMs: number
  private pendingRequestRecords = new Map<string, PendingRequestRecord>()
  private idempotencyCache = new Map<string, CachedRequestResponse>()
  /**
   * Tail of the FIFO chain that serializes async persistence writes. Undefined
   * until the first async `save()` is observed (synchronous backends never set
   * it, keeping their fast path). See {@link persistSnapshot}.
   */
  private saveChain: Promise<void> | undefined
  private broadcastResponseCache = new Map<string, CachedRequestResponse>()
  private persistence: SessionPersistence | undefined

  constructor(options: WalletSessionOptions) {
    super()
    this.transport = options.transport
    this.capabilities = options.capabilities
    this.meta = options.meta
    this.sessionTtl = options.sessionTtl ?? DEFAULT_SESSION_TTL
    this.heartbeatInterval = options.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL
    this.heartbeatTimeout = options.heartbeatTimeout ?? DEFAULT_HEARTBEAT_TIMEOUT
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS
    this.maxReconnectDurationMs = options.maxReconnectDurationMs ?? DEFAULT_MAX_RECONNECT_DURATION
    this.effectiveCapabilities = { ...options.capabilities }
    this.persistence = options.persistence

    this.transport.onMessage((msg) => this.handleMessage(msg))
    this.transport.onClose((info) => this.handleTransportClose(info))
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Prepare to join a channel by parsing a pairing URI.
   * Computes local keys and the session fingerprint without connecting.
   * Returns the 4-digit session fingerprint for user verification.
   */
  prepareJoin(uri: string): string {
    const parsed = parsePairingUri(uri)
    this.intentionalClose = false
    this.channelId = parsed.ch
    this.remotePubKey = b64urlDecode(parsed.pubkey)
    this.relayUrl = parsed.relay ?? ''
    this.dappName = parsed.name
    this.dappDeclaredMethods = parsed.methods
    this.dappDeclaredChains = parsed.chains
    this.sendSeq = 0
    this.recvSeq = -1
    this.sendKey = null
    this.recvKey = null
    this.pendingRequestRecords.clear()
    this.idempotencyCache.clear()
    this.broadcastResponseCache.clear()

    // Compute effective capabilities via scope intersection (§8.1)
    this.effectiveCapabilities = this.computeScopeIntersection()

    const kp = generateX25519KeyPair()
    this.privKey = kp.privateKey
    this.pubKeyB64 = kp.publicKeyB64

    // Derive root and directional traffic keys immediately.
    const shared = computeSharedSecret(this.privKey, this.remotePubKey)
    const rootKey = deriveSessionKey(shared, this.channelId)
    // §20.7: erase shared_secret immediately after root_key derivation
    shared.fill(0)

    const context = this.sessionContext()
    const keys = deriveDirectionalSessionKeys(rootKey, this.channelId, context)
    this.sendKey = keys.walletToDappKey
    this.recvKey = keys.dappToWalletKey

    this.sessionFingerprint = computeSessionFingerprint(
      this.channelId,
      b64urlEncode(this.remotePubKey),
    )
    this.emit('sessionFingerprint', this.sessionFingerprint)

    // Always derive join encryption key for sealed_join before erasing rootKey
    this.sessionKey = deriveJoinEncryptionKey(rootKey, this.channelId)

    // §20.7: erase root_key after all derivations complete
    rootKey.fill(0)
    keys.rootKey.fill(0)
    keys.transcriptHash.fill(0)

    return this.sessionFingerprint
  }

  /**
   * Send the join message after the user has verified the session fingerprint.
   */
  async confirmJoin(): Promise<void> {
    if (!this.channelId || !this.sendKey || !this.recvKey) {
      throw new Error('Must call prepareJoin() first')
    }

    // Update transport URL if WebSocket, add ?ch= for CF Worker relay routing
    const transportWithUrl = this.transport as Transport & { setUrl?: (url: string) => void }
    if (typeof transportWithUrl.setUrl === 'function') {
      let url = this.relayUrl
      if (this.channelId && !url.includes('?ch=')) {
        const sep = url.includes('?') ? '&' : '?'
        url = `${url}${sep}ch=${this.channelId}`
      }
      transportWithUrl.setUrl(url)
    }

    await this.transport.connect()
    this.setPhase('waiting_accept')
    await this.sendJoin()
  }

  /**
   * Join a channel in one step (convenience method).
   * Equivalent to prepareJoin() + confirmJoin().
   */
  async joinFromUri(uri: string): Promise<string> {
    const code = this.prepareJoin(uri)
    await this.confirmJoin()
    return code
  }

  /** Respond to a request with success. */
  approve(requestId: string, result: unknown): boolean | Promise<boolean> {
    const sent = this.sendResponse(requestId, true, result)
    const afterSend = (ok: boolean) => {
      if (ok) this.cacheProcessedResponse(requestId, true, result)
      return ok
    }
    return isPromiseLike<boolean>(sent) ? sent.then(afterSend) : afterSend(sent)
  }

  /** Respond to a request with rejection. */
  reject(
    requestId: string,
    code = 'user_rejected',
    message = 'User rejected the request',
  ): boolean | Promise<boolean> {
    const error = { code, message }
    const sent = this.sendResponse(requestId, false, error)
    const afterSend = (ok: boolean) => {
      if (ok) this.cacheProcessedResponse(requestId, false, error)
      return ok
    }
    return isPromiseLike<boolean>(sent) ? sent.then(afterSend) : afterSend(sent)
  }

  /** Push an event to the dApp. */
  pushEvent(event: string, data: unknown): boolean | Promise<boolean> {
    if (this.phase !== 'connected' || !this.sendKey) return false
    const seq = this.nextSendSeq()
    const evtId = `evt-${++this.evtCounter}`
    const send = (reservedSeq: number | null): boolean => {
      if (reservedSeq == null || !this.sendKey) return false
      // Privacy mode (§7.4): encrypt event name inside sealed payload
      const sealedData = {
        _event: event,
        ...(data && typeof data === 'object' ? (data as Record<string, unknown>) : { _data: data }),
      }
      const hdr = { type: 'evt' as const, from: this.pubKeyB64, id: evtId }
      const sealed = sealPayload(this.sendKey, this.channelId, reservedSeq, sealedData, hdr)
      this.sendRaw({
        v: 1,
        t: 'evt',
        ch: this.channelId,
        ts: Date.now(),
        from: this.pubKeyB64,
        body: { id: evtId, sealed },
      } as ProtocolMessage)
      return true
    }
    return isPromiseLike<number | null>(seq) ? seq.then(send) : send(seq)
  }

  /** Send ping. */
  ping(): void {
    if (this.phase !== 'connected') return
    this.sendRaw({
      v: 1,
      t: 'ping',
      ch: this.channelId,
      ts: Date.now(),
      from: this.pubKeyB64,
      body: {},
    } as ProtocolMessage)
  }

  /** Gracefully close. */
  close(reason: string = 'normal'): void {
    recordDisconnect({
      side: 'wallet',
      kind: 'session_close',
      reason,
      phase: this.phase,
      channelId: this.channelId,
      willReconnect: false,
    })
    this.intentionalClose = true
    this.stopReconnect()
    this.clearSessionTtl()
    this.pendingRequestRecords.clear()
    this.idempotencyCache.clear()
    this.broadcastResponseCache.clear()
    if (this.channelId) {
      this.sendRaw({
        v: 1,
        t: 'close',
        ch: this.channelId,
        ts: Date.now(),
        from: this.pubKeyB64,
        body: { reason },
      } as ProtocolMessage)
    }
    this.clearPersistence()
    this.transport.disconnect()
    this.setPhase('closed')
  }

  /** Destroy and release all resources. */
  destroy(): void {
    this.close()
    this.removeAll()
    // Wipe sensitive key material (§20.7)
    if (this.privKey) this.privKey.fill(0)
    if (this.sessionKey) this.sessionKey.fill(0)
    if (this.sendKey) this.sendKey.fill(0)
    if (this.recvKey) this.recvKey.fill(0)
    this.pendingRequestRecords.clear()
    this.idempotencyCache.clear()
    this.broadcastResponseCache.clear()
    this.sessionKey = null
    this.sendKey = null
    this.recvKey = null
  }

  // -------------------------------------------------------------------------
  // State serialization
  // -------------------------------------------------------------------------

  serialize(): string {
    const json = JSON.stringify({
      channelId: this.channelId,
      privKey: bytesToHex(this.privKey),
      pubKeyB64: this.pubKeyB64,
      remotePubKeyB64: this.remotePubKey ? b64urlEncode(this.remotePubKey) : null,
      sendKey: this.sendKey ? bytesToHex(this.sendKey) : null,
      recvKey: this.recvKey ? bytesToHex(this.recvKey) : null,
      sendSeq: this.sendSeq,
      recvSeq: this.recvSeq,
      relayUrl: this.relayUrl,
      capabilities: this.capabilities,
      meta: this.meta ?? null,
      dappName: this.dappName ?? null,
      sessionStartTime: this.sessionStartTime,
    })
    // HMAC-tag the snapshot to catch accidental corruption and partial/torn
    // writes on restore. NOTE: this is NOT a defense against an attacker who can
    // write storage — the MAC key (sendKey) lives in the signed plaintext, so
    // such an attacker can forge a valid tag, and restore() also accepts
    // unsigned JSON for backward compatibility. Confidentiality of the key
    // material at rest is out of scope (see security-audit-brief.md).
    return this.sendKey ? signSnapshot(this.sendKey, json) : json
  }

  restore(signed: string): boolean {
    try {
      let json: string
      if (signed.length > 65 && signed[64] === '.') {
        const candidateJson = signed.slice(65)
        const d0 = JSON.parse(candidateJson)
        if (!d0.sendKey) return false
        const sendKey = hexToBytes(d0.sendKey)
        const verified = verifySnapshot(sendKey, signed)
        if (!verified) return false
        json = verified
      } else {
        json = signed
      }

      const d = JSON.parse(json)
      if (!d.channelId || !d.privKey) return false
      this.channelId = d.channelId
      this.privKey = hexToBytes(d.privKey)
      this.pubKeyB64 = d.pubKeyB64
      this.remotePubKey = d.remotePubKeyB64 ? b64urlDecode(d.remotePubKeyB64) : null
      this.sendKey = d.sendKey ? hexToBytes(d.sendKey) : null
      this.recvKey = d.recvKey ? hexToBytes(d.recvKey) : null
      if (!this.sendKey || !this.recvKey) return false
      this.sendSeq = d.sendSeq ?? 0
      this.recvSeq = d.recvSeq ?? -1
      this.relayUrl = d.relayUrl
      if (
        'capabilities' in d &&
        canonicalJson(d.capabilities ?? null) !== canonicalJson(this.capabilities ?? null)
      ) {
        return false
      }
      if ('meta' in d && canonicalJson(d.meta ?? null) !== canonicalJson(this.meta ?? null)) {
        return false
      }
      this.dappName = d.dappName ?? undefined
      this.sessionStartTime = d.sessionStartTime ?? null
      this.setPhase('connected')
      return true
    } catch {
      return false
    }
  }

  async restoreFromPersistence(): Promise<boolean> {
    if (!this.persistence?.load) return false
    const json = await this.persistence.load()
    return json ? this.restore(json) : false
  }

  async reconnect(): Promise<void> {
    this.intentionalClose = false
    this.stopReconnect()
    this.setPhase('disconnected')
    this.reconnectAttempt = 0
    await this.doReconnectAttempt()
  }

  // -------------------------------------------------------------------------
  // Internal: message handling
  // -------------------------------------------------------------------------

  private handleMessage(msg: ProtocolMessage): void {
    // §2: Peers MUST reject any peer-sent message where from equals "_adapter"
    if (msg.t !== 'ready' && msg.t !== 'terminate' && msg.from === '_adapter') {
      this.emit('error', new Error('Rejected message with spoofed _adapter from'))
      return
    }

    // §15 rule 12: reject unsupported protocol version
    if (msg.v !== 1) {
      this.close('unsupported_version')
      return
    }

    switch (msg.t) {
      case 'ready': {
        const readyBody = msg.body as {
          state?: string
          reconnect?: boolean
          remote?: string | null
        }
        this.stopReconnect()
        if (readyBody.state === 'connected') {
          const expectedRemote = this.remotePubKey ? b64urlEncode(this.remotePubKey) : null
          if (!expectedRemote || readyBody.remote !== expectedRemote) {
            this.emit('error', new Error('Connected remote does not match paired dApp'))
            this.close()
            break
          }
        }
        if (readyBody.state === 'waiting') {
          this.setPhase('waiting_accept')
        } else if (readyBody.state === 'connected') {
          this.reconnecting = false
          this.reconnectAttempt = 0
          this.reconnectStartedAt = 0
          this.setPhase('connected')
          this.startSessionTtl()
          this.startHeartbeat()
          this.persistSnapshotAsync()
        }
        break
      }

      case 'req': {
        if (this.phase !== 'connected') break
        const reqBody = msg.body as { id?: string; sealed?: string }
        if (this.remotePubKey && msg.from !== b64urlEncode(this.remotePubKey)) break
        // All requests MUST be sealed — reject unsealed requests to prevent
        // method injection by a malicious relay.
        if (!reqBody.sealed || !reqBody.id || !this.recvKey) {
          if (reqBody.id) {
            this.observeSend(this.reject(reqBody.id, 'protocol_error', 'Request must be encrypted'))
          }
          break
        }
        const requestId = reqBody.id
        try {
          // AAD: no method field — real method is inside sealed payload
          const reqHdr = { type: 'req' as const, from: msg.from, id: requestId }
          const { seq, data, plaintext } = unsealPayload(
            this.recvKey,
            this.channelId,
            reqBody.sealed,
            reqHdr,
          )
          if (seq <= this.recvSeq) break // replay — silently drop
          const prevRecvSeq = this.recvSeq
          this.recvSeq = seq
          const afterPersist = () => this.processRequest(requestId, data, plaintext)
          const persisted = this.persistSnapshot()
          if (isPromiseLike(persisted)) {
            void persisted.then(afterPersist).catch((e) => {
              this.recvSeq = prevRecvSeq // rollback on persist failure
              this.emit('error', this.persistenceError(e))
            })
          } else {
            afterPersist()
          }
        } catch {
          this.observeSend(this.reject(requestId, 'decryption_failed', 'Failed to decrypt request'))
        }
        break
      }

      case 'ping':
        this.sendRaw({
          v: 1,
          t: 'pong',
          ch: this.channelId,
          ts: Date.now(),
          from: this.pubKeyB64,
          body: {},
        } as ProtocolMessage)
        break

      case 'pong':
        this.clearLiveness()
        break

      case 'close': {
        if (this.phase !== 'disconnected') {
          this.pendingRequestRecords.clear()
          this.idempotencyCache.clear()
          this.broadcastResponseCache.clear()
          this.clearPersistence()
          this.setPhase('closed')
          this.intentionalClose = true
        }
        break
      }

      case 'terminate': {
        const reason = (msg.body as { reason?: string }).reason
        const recoverable = isRecoverableCloseReason(reason)
        const willReconnect = recoverable && this.canReconnect()
        recordDisconnect({
          side: 'wallet',
          kind: 'terminate',
          reason,
          phase: this.phase,
          channelId: this.channelId,
          willReconnect,
        })
        // Already finished — nothing left to recover.
        if (this.intentionalClose || this.phase === 'closed') break
        if (recoverable) {
          // Relay dropped us for a transient/recoverable reason (channel_not_found
          // when the dApp momentarily disconnected, rate_limited, payload_too_large,
          // timeout, invalid_state, …). Keep the session and reconnect — do NOT
          // wipe persistence. Disconnect first so the socket's own onclose can't
          // double-trigger reconnect.
          this.transport.disconnect()
          this.startReconnect()
        } else {
          // Genuinely terminal (normal / user_rejected / unsupported_* /
          // already_connected / decryption_failed) — close permanently.
          this.pendingRequestRecords.clear()
          this.idempotencyCache.clear()
          this.broadcastResponseCache.clear()
          this.clearPersistence()
          this.setPhase('closed')
          this.intentionalClose = true
        }
        break
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internal: responses and request idempotency
  // -------------------------------------------------------------------------

  private processRequest(requestId: string, data: unknown, plaintext: Uint8Array): void {
    // Extract _method from decrypted payload
    if (!data || typeof data !== 'object') {
      this.observeSend(this.reject(requestId, 'invalid_params', 'Request payload missing _method'))
      return
    }
    const payload = data as { _method?: unknown } & Record<string, unknown>
    if (typeof payload._method !== 'string' || payload._method.length === 0) {
      this.observeSend(this.reject(requestId, 'invalid_params', 'Request payload missing _method'))
      return
    }
    const method = payload._method
    // §7.1 runtime enforcement: reject methods not in capabilities
    if (!this.effectiveCapabilities.methods.includes(method)) {
      this.observeSend(
        this.reject(
          requestId,
          'unsupported_method',
          `Method "${method}" not in granted capabilities`,
        ),
      )
      return
    }
    const {
      _method: _,
      _params,
      ...rest
    } = payload as { _method: string; _params?: unknown } & Record<string, unknown>
    const params: unknown = _params !== undefined ? _params : rest
    const paramsHash = sha256Hex(plaintext)

    const cachedBroadcast = this.broadcastResponseCache.get(requestId)
    if (cachedBroadcast) {
      if (!constantTimeEqual(cachedBroadcast.paramsHash, paramsHash)) {
        this.observeSend(
          this.reject(requestId, 'invalid_params', 'Duplicate request ID with different params'),
        )
        return
      }
      this.observeSend(this.sendResponse(requestId, cachedBroadcast.ok, cachedBroadcast.data))
      return
    }

    const cached = this.idempotencyCache.get(requestId)
    if (cached) {
      if (!constantTimeEqual(cached.paramsHash, paramsHash)) {
        this.observeSend(
          this.reject(requestId, 'invalid_params', 'Duplicate request ID with different params'),
        )
        return
      }
      this.touchIdempotencyEntry(requestId, cached)
      if (!cached.tooLarge) {
        this.observeSend(this.sendResponse(requestId, cached.ok, cached.data))
        return
      }
    }

    const pending = this.pendingRequestRecords.get(requestId)
    if (pending) {
      if (!constantTimeEqual(pending.paramsHash, paramsHash)) {
        this.observeSend(
          this.reject(requestId, 'invalid_params', 'Duplicate request ID with different params'),
        )
      }
      return
    }

    // §15 rule 11: max 32 pending requests
    if (this.pendingRequestRecords.size >= MAX_PENDING_REQUESTS) {
      this.observeSend(this.reject(requestId, 'rate_limited', 'Too many pending requests'))
      return
    }

    this.pendingRequestRecords.set(requestId, { paramsHash, method })

    this.emit('request', { id: requestId, method, params })
  }

  private sendResponse(requestId: string, ok: boolean, data: unknown): boolean | Promise<boolean> {
    if (!this.sendKey) return false
    const seq = this.nextSendSeq()
    const send = (reservedSeq: number | null): boolean => {
      if (reservedSeq == null || !this.sendKey) return false
      // Per protocol §5.3: success = { _ok: true, _result: <result> }
      //                     error   = { _ok: false, code: "...", message: "..." }
      const sealedPayload = ok
        ? { _ok: true, _result: data }
        : { _ok: false, ...(data as Record<string, unknown>) }
      const hdr = { type: 'res' as const, from: this.pubKeyB64, id: requestId }
      const sealed = sealPayload(this.sendKey, this.channelId, reservedSeq, sealedPayload, hdr)
      this.sendRaw({
        v: 1,
        t: 'res',
        ch: this.channelId,
        ts: Date.now(),
        from: this.pubKeyB64,
        body: { id: requestId, sealed },
      } as ProtocolMessage)
      return true
    }
    return isPromiseLike<number | null>(seq) ? seq.then(send) : send(seq)
  }

  private cacheProcessedResponse(requestId: string, ok: boolean, data: unknown): void {
    const pending = this.pendingRequestRecords.get(requestId)
    if (!pending) return
    this.pendingRequestRecords.delete(requestId)

    const serialized = JSON.stringify(data ?? null)
    const tooLarge = new TextEncoder().encode(serialized).length > IDEMPOTENCY_RESPONSE_LIMIT_BYTES
    const entry: CachedRequestResponse = {
      ...pending,
      ok,
      data: tooLarge ? null : data,
      tooLarge,
    }

    this.idempotencyCache.set(requestId, entry)
    this.evictIdempotencyCache()

    if (pending.method === 'wallet_sendTransaction' && ok) {
      this.broadcastResponseCache.set(requestId, {
        ...pending,
        ok,
        data,
        tooLarge: false,
      })
      this.evictBroadcastCache()
    }
  }

  private touchIdempotencyEntry(requestId: string, entry: CachedRequestResponse): void {
    this.idempotencyCache.delete(requestId)
    this.idempotencyCache.set(requestId, entry)
  }

  private evictIdempotencyCache(): void {
    while (this.idempotencyCache.size > IDEMPOTENCY_CACHE_LIMIT) {
      const oldest = this.idempotencyCache.keys().next().value as string | undefined
      if (!oldest) return
      this.idempotencyCache.delete(oldest)
    }
  }

  private evictBroadcastCache(): void {
    while (this.broadcastResponseCache.size > BROADCAST_CACHE_LIMIT) {
      const oldest = this.broadcastResponseCache.keys().next().value as string | undefined
      if (!oldest) return
      this.broadcastResponseCache.delete(oldest)
    }
  }

  // -------------------------------------------------------------------------
  // Internal: transport
  // -------------------------------------------------------------------------

  private sendRaw(msg: ProtocolMessage): void {
    // §15 rule 10: max 64 KB on the wire
    const json = JSON.stringify(msg)
    if (new TextEncoder().encode(json).length > MAX_MESSAGE_BYTES) {
      this.emit('error', new Error('Message exceeds 64 KB limit'))
      return
    }
    this.transport.send(msg)
  }

  private sendJoin(): void | Promise<void> {
    const body: Record<string, unknown> = {
      sealed_join: null,
    }
    if (this.sessionKey) {
      // Initial join: encrypt capabilities/meta in sealed_join
      body.sealed_join = sealJoin(
        this.sessionKey,
        this.channelId,
        this.effectiveCapabilities,
        this.meta,
      )
      // §20.7: erase join_encryption_key after one-shot use
      this.sessionKey.fill(0)
      this.sessionKey = null
    }
    // else: reconnect — sealed_join stays null (capabilities already negotiated)
    const msg = {
      v: 1,
      t: 'join',
      ch: this.channelId,
      ts: Date.now(),
      from: this.pubKeyB64,
      body,
    } as ProtocolMessage
    const send = () => this.sendRaw(msg)
    const persisted = this.persistSnapshot()
    if (isPromiseLike(persisted)) {
      return persisted.then(send).catch((e) => {
        throw this.persistenceError(e)
      })
    }
    send()
  }

  private sessionContext(): SessionCryptoContext {
    return {
      dappPubKeyB64: this.remotePubKey ? b64urlEncode(this.remotePubKey) : '',
      walletPubKeyB64: this.pubKeyB64,
      capabilities: this.effectiveCapabilities,
      walletMeta: this.meta ?? null,
      dappName: this.dappName,
    }
  }

  /**
   * Compute the intersection of wallet capabilities with dApp-declared
   * scope from the pairing URI (§8.1).
   */
  private computeScopeIntersection(): Capabilities {
    const base = this.capabilities
    // §7.1: Wallet MUST check it can satisfy dApp's minimum requirements.
    // Wallet MAY grant additional methods/chains beyond what was requested.
    // We grant all wallet capabilities (not just the intersection).
    if (this.dappDeclaredMethods?.length) {
      const granted = new Set(base.methods)
      const unsatisfied = this.dappDeclaredMethods.filter((m) => !granted.has(m))
      if (unsatisfied.length > 0) {
        // Wallet cannot satisfy dApp's requirements — emit warning but proceed
        // (the dApp will check and close if needed)
      }
    }
    if (this.dappDeclaredChains?.length) {
      const granted = new Set(base.chains)
      const unsatisfied = this.dappDeclaredChains.filter((c) => !granted.has(c))
      if (unsatisfied.length > 0) {
        // Same as above
      }
    }
    const result: Capabilities = { methods: base.methods, events: base.events, chains: base.chains }
    if (base.version != null) result.version = base.version
    // Pass-through wallet metadata — these are not scope-negotiated and the dApp
    // side depends on them: rpcUrls (local read-only proxy), walletCapabilities
    // (wallet_getCapabilities / EIP-5792), and contractBytecode (eth_getCode for
    // a counterfactual smart contract wallet). Dropping them silently breaks all
    // three on the dApp side.
    if (base.rpcUrls != null) result.rpcUrls = base.rpcUrls
    if (base.walletCapabilities != null) result.walletCapabilities = base.walletCapabilities
    if (base.contractBytecode != null) result.contractBytecode = base.contractBytecode
    return result
  }

  private nextSendSeq(): number | null | Promise<number | null> {
    if (this.sendSeq >= MAX_SEND_SEQ) {
      const error = new Error('Send sequence overflow/limit reached — session invalidated')
      this.emit('error', error)
      this.close()
      return null
    }
    const seq = this.sendSeq
    this.sendSeq += 1
    const persisted = this.persistSnapshot()
    if (isPromiseLike(persisted)) {
      return persisted
        .then(() => seq)
        .catch((e) => {
          throw this.persistenceError(e)
        })
    }
    return seq
  }

  private persistSnapshot(): void | Promise<void> {
    if (!this.persistence) return
    // Capture the snapshot synchronously so it reflects the seq counters at
    // THIS call site (nextSendSeq has already advanced sendSeq before calling).
    const snapshot = this.serialize()
    const prior = this.saveChain
    if (prior === undefined) {
      // No async save in flight — try the synchronous fast path. A backend
      // whose save() returns void has already persisted durably, so there is
      // nothing to reorder and no chain is needed.
      const result = this.persistence.save(snapshot)
      if (!isPromiseLike(result)) return
      this.saveChain = result.then(NOOP, NOOP)
      return result
    }
    // An async backend is in use. Serialize this save behind the previous one
    // so a snapshot carrying a lower sendSeq can never be durably written after
    // one carrying a higher sendSeq — which, under a backend that completes
    // concurrent save() calls out of order, would let a crash+restore regress
    // sendSeq and reuse a ChaCha20-Poly1305 nonce (catastrophic keystream/tag
    // reuse). Every send is write-ahead gated on the returned promise.
    const save = prior.then(() => this.persistence!.save(snapshot))
    this.saveChain = save.then(NOOP, NOOP)
    return save
  }

  private persistSnapshotAsync(): void {
    const persisted = this.persistSnapshot()
    if (isPromiseLike(persisted)) {
      void persisted.catch((e) => this.persistenceError(e))
    }
  }

  private clearPersistence(): void {
    if (!this.persistence?.clear) return
    const cleared = this.persistence.clear()
    if (isPromiseLike(cleared)) {
      void cleared.catch((e) => {
        const err = e instanceof Error ? e : new Error(String(e))
        this.emit('error', err)
      })
    }
  }

  private observeSend(result: boolean | Promise<boolean>): void {
    if (isPromiseLike(result)) {
      void result.catch((e) => {
        const err = e instanceof Error ? e : new Error(String(e))
        this.emit('error', err)
      })
    }
  }

  private persistenceError(error: unknown): Error {
    const err = error instanceof Error ? error : new Error(String(error))
    const wrapped = new Error(`Session persistence failed: ${err.message}`)
    this.emit('error', wrapped)
    this.close('protocol_error')
    return wrapped
  }

  /** Whether the session is still eligible to auto-reconnect. */
  private canReconnect(): boolean {
    return !this.intentionalClose && this.phase !== 'closed'
  }

  private handleTransportClose(info?: TransportCloseInfo): void {
    const willReconnect = this.canReconnect()
    recordDisconnect({
      side: 'wallet',
      kind: 'transport_close',
      code: info?.code,
      reason: info?.reason ?? (info?.wasError ? 'transport_error' : undefined),
      phase: this.phase,
      channelId: this.channelId,
      willReconnect,
    })
    if (!willReconnect) return
    this.startReconnect()
  }

  // -------------------------------------------------------------------------
  // Internal: reconnect
  // -------------------------------------------------------------------------

  private startReconnect(): void {
    // Preserve the growing backoff when already mid-reconnect (avoids a tight
    // loop when the relay keeps terminating us). Keyed off an explicit flag, not
    // the phase, so a terminate arriving while still 'connected' doesn't reset
    // the backoff. Cleared only on a successful reconnect.
    const wasReconnecting = this.reconnecting
    this.reconnecting = true
    this.setPhase('disconnected')
    if (!wasReconnecting) {
      this.reconnectAttempt = 0
      this.reconnectStartedAt = 0
    }
    this.scheduleReconnect()
  }

  /** Whether the current reconnect streak has hit its attempt or duration cap. */
  private reconnectExhausted(): boolean {
    const attemptsCapped =
      this.maxReconnectAttempts > 0 && this.reconnectAttempt >= this.maxReconnectAttempts
    const durationCapped =
      this.maxReconnectDurationMs > 0 &&
      this.reconnectStartedAt > 0 &&
      Date.now() - this.reconnectStartedAt >= this.maxReconnectDurationMs
    return attemptsCapped || durationCapped
  }

  /** Give up reconnecting: clear caches, emit `reconnectExhausted`, close. */
  private giveUpReconnect(): void {
    this.stopReconnect()
    this.reconnecting = false
    const attempts = this.reconnectAttempt
    recordDisconnect({
      side: 'wallet',
      kind: 'reconnect_failed',
      reason: 'reconnect_exhausted',
      phase: this.phase,
      channelId: this.channelId,
      willReconnect: false,
    })
    this.pendingRequestRecords.clear()
    this.idempotencyCache.clear()
    this.broadcastResponseCache.clear()
    this.clearPersistence()
    this.intentionalClose = true
    this.emit('reconnectExhausted', { attempts })
    this.setPhase('closed')
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose || this.phase === 'closed') return
    if (this.reconnectStartedAt === 0) this.reconnectStartedAt = Date.now()
    if (this.reconnectExhausted()) {
      this.giveUpReconnect()
      return
    }
    this.stopReconnect() // idempotent: never stack reconnect timers
    const base = BACKOFF[Math.min(this.reconnectAttempt, BACKOFF.length - 1)] ?? 1000
    const delay = base + Math.floor(Math.random() * base * 0.3) // ±30% jitter
    this.reconnectTimer = setTimeout(() => {
      this.doReconnectAttempt()
      this.reconnectAttempt++
    }, delay)
  }

  private async doReconnectAttempt(): Promise<void> {
    if (this.intentionalClose || this.phase === 'closed') return
    try {
      // Re-set URL with ?ch= for CF Worker relay routing
      const t = this.transport as any
      if (typeof t.setUrl === 'function' && this.channelId) {
        let url = this.relayUrl
        if (!url.includes('?ch=')) {
          const sep = url.includes('?') ? '&' : '?'
          url = `${url}${sep}ch=${this.channelId}`
        }
        t.setUrl(url)
      }
      await this.transport.connect()
      this.setPhase('waiting_accept')
      await this.sendJoin()
    } catch {
      recordDisconnect({
        side: 'wallet',
        kind: 'reconnect_failed',
        phase: this.phase,
        channelId: this.channelId,
        willReconnect: this.canReconnect(),
      })
      this.scheduleReconnect()
    }
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  // -------------------------------------------------------------------------
  // Internal: session TTL (§16 rule 16)
  // -------------------------------------------------------------------------

  private startSessionTtl(): void {
    this.clearSessionTtl()
    if (this.sessionStartTime == null) {
      this.sessionStartTime = Date.now()
    }
    const elapsed = Date.now() - this.sessionStartTime
    const remaining = Math.max(0, this.sessionTtl - elapsed)
    this.sessionTtlTimer = setTimeout(() => {
      this.emit('error', new Error('Session lifetime expired'))
      this.close('timeout')
    }, remaining)
  }

  private clearSessionTtl(): void {
    if (this.sessionTtlTimer) {
      clearTimeout(this.sessionTtlTimer)
      this.sessionTtlTimer = null
    }
  }

  // -------------------------------------------------------------------------
  // Internal: heartbeat / liveness (P0-2)
  // -------------------------------------------------------------------------

  private startHeartbeat(): void {
    this.stopHeartbeat()
    if (this.heartbeatInterval <= 0) return
    this.heartbeatTimer = setInterval(() => this.heartbeatTick(), this.heartbeatInterval)
    // Don't let the heartbeat keep a Node process (or test runner) alive on its own.
    ;(this.heartbeatTimer as unknown as { unref?: () => void }).unref?.()
  }

  private heartbeatTick(): void {
    if (this.phase !== 'connected') return
    this.ping()
    if (this.livenessTimer) return // already awaiting a pong from the previous tick
    this.livenessTimer = setTimeout(() => {
      this.livenessTimer = null
      // No pong within the deadline → the connection is dead even though the
      // socket never reported a close (half-open TCP). Force a reconnect.
      recordDisconnect({
        side: 'wallet',
        kind: 'transport_close',
        reason: 'heartbeat_timeout',
        phase: this.phase,
        channelId: this.channelId,
        willReconnect: this.canReconnect(),
      })
      this.transport.disconnect()
      this.handleTransportClose({ reason: 'heartbeat_timeout' })
    }, this.heartbeatTimeout)
    ;(this.livenessTimer as unknown as { unref?: () => void }).unref?.()
  }

  private clearLiveness(): void {
    if (this.livenessTimer) {
      clearTimeout(this.livenessTimer)
      this.livenessTimer = null
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    this.clearLiveness()
  }

  private setPhase(phase: WalletPhase): void {
    if (this.phase === phase) return
    this.phase = phase
    // Heartbeat only runs while connected; any transition away stops it. It is
    // (re)started explicitly when the relay reports the channel connected.
    if (phase !== 'connected') this.stopHeartbeat()
    this.emit('phase', phase)
  }
}
