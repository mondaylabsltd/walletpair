// @vitest-environment happy-dom
import { AdapterState, NetworkType, WalletReadyState, WalletSignMessageError } from '@tronweb3/tronwallet-abstract-adapter';
import { afterEach, describe, expect, it } from 'vitest';
import { WalletPairAdapter, WALLETPAIR_RDNS } from '../src/index.js';

const ADDRESS = 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7';

/** A stand-in for the extension's TIP-1193 provider (spec/networks/tron.md §3). */
function fakeProvider(options: { approved?: boolean; decline?: boolean } = {}) {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  const requests: { method: string; params?: unknown }[] = [];
  let approved = options.approved ?? false;
  const tronWeb = {
    defaultAddress: { base58: ADDRESS as string | false },
    fullNode: { host: 'https://nile.trongrid.io' },
    solidityNode: { host: 'https://nile.trongrid.io' },
    eventServer: { host: 'https://nile.trongrid.io' },
    trx: {
      sign: async (tx: any) => (options.decline ? Promise.reject('Confirmation declined by user') : { ...tx, signature: ['ab'] }),
      multiSign: async (tx: any, _: unknown, permissionId?: number) => ({ ...tx, signature: ['cd'], permissionId }),
      signMessageV2: async (message: string) => (options.decline ? Promise.reject('Confirmation declined by user') : `0x${message.length}`),
    },
  };
  const provider = {
    get tronWeb() {
      return approved ? tronWeb : false;
    },
    async request(args: { method: string; params?: unknown }) {
      requests.push(args);
      if (args.method === 'eth_requestAccounts') {
        approved = true;
        return [ADDRESS];
      }
      if (args.method === 'eth_chainId') return '0xcd8690dc';
      return null;
    },
    on(event: string, listener: (...args: any[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    removeListener(event: string, listener: (...args: any[]) => void) {
      listeners.get(event)?.delete(listener);
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  };
  return { provider, requests };
}

let announcer: (() => void) | undefined;

/** Announces the provider the way the extension does (TIP-6963). */
function install(provider: unknown, rdns = WALLETPAIR_RDNS, name = 'WalletPair') {
  const detail = Object.freeze({ info: { uuid: 'x', name, icon: 'data:,', rdns }, provider });
  announcer = () => window.dispatchEvent(new CustomEvent('TIP6963:announceProvider', { detail }));
  window.addEventListener('TIP6963:requestProvider', announcer);
}

afterEach(() => {
  if (announcer) window.removeEventListener('TIP6963:requestProvider', announcer);
  announcer = undefined;
  delete (window as { walletpair?: unknown }).walletpair;
});

const detected = (adapter: WalletPairAdapter) =>
  new Promise<void>((resolve) => {
    if (adapter.readyState !== WalletReadyState.Loading) return resolve();
    adapter.once('readyStateChanged', () => resolve());
  });

describe('WalletPairAdapter', () => {
  it('shows WalletPair, and finds the extension through TIP-6963', async () => {
    const { provider } = fakeProvider();
    install(provider);
    const adapter = new WalletPairAdapter({ checkTimeout: 200 });
    expect(adapter.name).toBe('WalletPair');
    expect(adapter.url).toBe('https://walletpair.org');
    expect(adapter.icon).toMatch(/^data:image\/svg\+xml;base64,/);
    await detected(adapter);
    expect(adapter.readyState).toBe(WalletReadyState.Found);
    expect(adapter.state).toBe(AdapterState.Disconnect);
  });

  it('ignores other wallets', async () => {
    install(fakeProvider().provider, 'org.tronlink.www', 'TronLink');
    const adapter = new WalletPairAdapter({ checkTimeout: 50 });
    await detected(adapter);
    expect(adapter.readyState).toBe(WalletReadyState.NotFound);
  });

  it('falls back to window.walletpair.tron', async () => {
    (window as { walletpair?: unknown }).walletpair = { tron: fakeProvider().provider };
    const adapter = new WalletPairAdapter({ checkTimeout: 50 });
    await detected(adapter);
    expect(adapter.readyState).toBe(WalletReadyState.Found);
  });

  it('a site already approved is connected from the start', async () => {
    install(fakeProvider({ approved: true }).provider);
    const adapter = new WalletPairAdapter({ checkTimeout: 200 });
    const connected = new Promise<string>((resolve) => adapter.once('connect', resolve));
    expect(await connected).toBe(ADDRESS);
    expect(adapter.address).toBe(ADDRESS);
  });

  it('connects, signs, multi-signs, tells the network and disconnects', async () => {
    const { provider, requests } = fakeProvider();
    install(provider);
    const adapter = new WalletPairAdapter({ checkTimeout: 200 });
    await adapter.connect();
    expect(adapter.connected).toBe(true);
    expect(adapter.address).toBe(ADDRESS);
    expect(await adapter.signMessage('hello')).toBe('0x5');
    expect(await adapter.signTransaction({ txID: '1' } as never)).toMatchObject({ signature: ['ab'] });
    expect(await adapter.multiSign({ txID: '1' } as never, { permissionId: 2 })).toMatchObject({ signature: ['cd'], permissionId: 2 });
    expect(await adapter.network()).toEqual({
      networkType: NetworkType.Nile,
      chainId: '0xcd8690dc',
      fullNode: 'https://nile.trongrid.io',
      solidityNode: 'https://nile.trongrid.io',
      eventServer: 'https://nile.trongrid.io',
    });
    await adapter.switchChain('0x2b6653dc');
    await adapter.disconnect();
    expect(adapter.connected).toBe(false);
    expect(requests.map((r) => r.method)).toEqual(['eth_requestAccounts', 'eth_chainId', 'wallet_switchEthereumChain', 'wallet_revokePermissions']);
  });

  it('turns the extension’s rejection string into an adapter error', async () => {
    install(fakeProvider({ approved: true, decline: true }).provider);
    const adapter = new WalletPairAdapter({ checkTimeout: 200 });
    await detected(adapter);
    const error = await adapter.signMessage('x').catch((e) => e);
    expect(error).toBeInstanceOf(WalletSignMessageError);
    expect(error.message).toBe('Confirmation declined by user');
  });

  it('follows account changes and the session ending', async () => {
    const { provider } = fakeProvider({ approved: true });
    install(provider);
    const adapter = new WalletPairAdapter({ checkTimeout: 200 });
    await detected(adapter);
    const events: unknown[][] = [];
    adapter.on('accountsChanged', (a, b) => events.push(['accountsChanged', a, b]));
    adapter.on('chainChanged', (c) => events.push(['chainChanged', c]));
    adapter.on('disconnect', () => events.push(['disconnect']));
    provider.emit('chainChanged', { chainId: '0x2b6653dc' });
    provider.emit('accountsChanged', []);
    expect(adapter.connected).toBe(false);
    expect(events).toEqual([
      ['chainChanged', { chainId: '0x2b6653dc' }],
      ['accountsChanged', '', ADDRESS],
      ['disconnect'],
    ]);
  });
});
