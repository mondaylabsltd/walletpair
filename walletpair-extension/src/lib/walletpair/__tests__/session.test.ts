import { describe, expect, it } from 'vitest';
import { createChannelCipher, decodeStoredSecretKey, generateX25519KeyPair } from '../crypto';
import { WalletPairSession } from '../session';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  binaryType: BinaryType = 'blob';
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly sent: string[] = [];

  constructor(readonly url: string) {
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    });
  }

  send(value: string) { this.sent.push(value); }
  close() { this.readyState = FakeWebSocket.CLOSED; }
  receive(value: string) { this.onmessage?.(new MessageEvent('message', { data: value })); }
}

async function drain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('WalletPairSession', () => {
  it('pins the first joiner automatically and exchanges encrypted Ethereum messages', async () => {
    let socket!: FakeWebSocket;
    let latestSnapshot = '';
    const session = new WalletPairSession({
      relayUrl: 'ws://127.0.0.1:3000/v1',
      meta: { name: 'DApp', url: 'https://dapp.example', icon: 'https://dapp.example/icon.png' },
      persist: async (snapshot) => { latestSnapshot = snapshot; },
      webSocketFactory: (url) => (socket = new FakeWebSocket(url)) as unknown as WebSocket,
    });

    await session.createPairing();
    const connection = new URL(socket.url);
    expect([...connection.searchParams.keys()].sort()).toEqual(['ch', 'icon', 'name', 'pubkey', 'url']);
    const own = Object.fromEntries(connection.searchParams);
    socket.receive(JSON.stringify({ type: 'channel_joined', ...own }));

    const wallet = generateX25519KeyPair();
    const walletJoin = {
      type: 'channel_joined',
      ch: own.ch!,
      name: 'Test Wallet',
      url: 'https://wallet.example',
      icon: 'https://wallet.example/icon.png',
      pubkey: wallet.publicKeyBase64Url,
    };
    socket.receive(JSON.stringify(walletJoin));
    await drain();
    expect(session.phase).toBe('connected');
    expect(session.walletMeta?.name).toBe('Test Wallet');

    const snapshot = JSON.parse(latestSnapshot);
    const walletCipher = createChannelCipher(
      own.ch!,
      'wallet',
      wallet.secretKey,
      own.pubkey!,
      wallet.publicKeyBase64Url,
    );
    const requestPromise = session.request({ method: 'eth_chainId', params: [] }, 'eip155:1');
    await drain();
    expect(socket.sent).toHaveLength(1);
    const opened = await walletCipher.open(socket.sent[0]!, async () => {});
    expect(opened.value).toMatchObject({ method: 'eth_chainId', params: [] });

    const requestId = (opened.value as { id: string }).id;
    const response = await walletCipher.seal({ id: requestId, result: '0x1' }, 'eip155:1', async () => {});
    socket.receive(response);
    await expect(requestPromise).resolves.toBe('0x1');

    expect(decodeStoredSecretKey(snapshot.secretKey)).toHaveLength(32);
    session.close();
  });

  it('ignores every participant after the first eligible joiner', async () => {
    let socket!: FakeWebSocket;
    const session = new WalletPairSession({
      relayUrl: 'ws://127.0.0.1:3000/v1',
      meta: { name: 'DApp', url: 'https://dapp.example', icon: 'https://dapp.example/icon.png' },
      webSocketFactory: (url) => (socket = new FakeWebSocket(url)) as unknown as WebSocket,
    });
    await session.createPairing();
    const identity = Object.fromEntries(new URL(socket.url).searchParams);
    socket.receive(JSON.stringify({ type: 'channel_joined', ...identity }));

    for (const name of ['First Wallet', 'Attacker']) {
      const pair = generateX25519KeyPair();
      socket.receive(JSON.stringify({
        type: 'channel_joined', ch: identity.ch, name,
        url: `https://${name === 'Attacker' ? 'attacker' : 'wallet'}.example`,
        icon: `https://${name === 'Attacker' ? 'attacker' : 'wallet'}.example/icon.png`,
        pubkey: pair.publicKeyBase64Url,
      }));
      await drain();
    }
    expect(session.walletMeta?.name).toBe('First Wallet');
    session.close();
  });

  it('abandons the channel if sequence persistence fails before encryption', async () => {
    let socket!: FakeWebSocket;
    let failPersistence = false;
    const session = new WalletPairSession({
      relayUrl: 'ws://127.0.0.1:3000/v1',
      meta: { name: 'DApp', url: 'https://dapp.example', icon: 'https://dapp.example/icon.png' },
      persist: async () => { if (failPersistence) throw new Error('storage unavailable'); },
      webSocketFactory: (url) => (socket = new FakeWebSocket(url)) as unknown as WebSocket,
    });
    await session.createPairing();
    const identity = Object.fromEntries(new URL(socket.url).searchParams);
    socket.receive(JSON.stringify({ type: 'channel_joined', ...identity }));
    const wallet = generateX25519KeyPair();
    socket.receive(JSON.stringify({
      type: 'channel_joined', ch: identity.ch, name: 'Wallet',
      url: 'https://wallet.example', icon: 'https://wallet.example/icon.png',
      pubkey: wallet.publicKeyBase64Url,
    }));
    await drain();
    expect(session.phase).toBe('connected');

    failPersistence = true;
    await expect(session.request({ method: 'eth_chainId' }, 'eip155:1')).rejects.toThrow();
    expect(socket.sent).toHaveLength(0);
    expect(session.phase).toBe('closed');
  });
});
