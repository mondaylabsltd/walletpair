// The page providers against a scripted bridge: how each network's API maps
// onto WalletPair calls (spec/networks/*.md §3).

import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { TronWeb } from 'tronweb';
import type { Bridge } from '../src/lib/inpage/bridge';
import { ProviderRpcError } from '../src/lib/inpage/bridge';
import { createEvmProvider } from '../src/lib/inpage/evm';
import { createSolanaWallet } from '../src/lib/inpage/solana';
import { DECLINED, createTron } from '../src/lib/inpage/tron';
import { base64Encode, bytesToHex } from '../src/lib/walletpair/codec';
import type { PageCall, SiteState } from '../src/lib/types';

const EVM = { chain: 'eip155:1', accounts: ['0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'] };
const TRON = { chain: 'tron:728126428', accounts: ['TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7'] };
const SOLANA = { chain: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', accounts: ['7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv'] };

/** A bridge whose answers the test scripts, and whose state the test sets. */
function fakeBridge(answer: (call: PageCall) => unknown = () => null) {
  let state: SiteState = {};
  let live = true;
  const listeners: ((previous: SiteState, wasLive: boolean) => void)[] = [];
  const calls: PageCall[] = [];
  let gestures = 0;
  const bridge: Bridge = {
    get state() {
      return state;
    },
    get live() {
      return live;
    },
    async call<T>(call: PageCall): Promise<T> {
      calls.push(call);
      const value = answer(call);
      if (value instanceof Error) throw value;
      return value as T;
    },
    subscribe: (listener) => void listeners.push(listener),
    gesture: () => void gestures++,
  };
  const set = (next: SiteState, nextLive = true) => {
    const previous = state;
    const wasLive = live;
    state = next;
    live = nextLive;
    for (const listener of listeners) listener(previous, wasLive);
  };
  return { bridge, calls, set, gestures: () => gestures };
}

describe('EVM provider', () => {
  it('answers accounts and chain locally, from the site state', async () => {
    const { bridge, set } = fakeBridge();
    const provider = createEvmProvider(bridge);
    expect(await provider.request({ method: 'eth_accounts' })).toEqual([]);
    expect(await provider.request({ method: 'eth_chainId' })).toBe('0x1');
    set({ eip155: { chain: 'eip155:137', accounts: EVM.accounts } });
    expect(await provider.request({ method: 'eth_accounts' })).toEqual(EVM.accounts);
    expect(await provider.request({ method: 'eth_chainId' })).toBe('0x89');
    expect(await provider.request({ method: 'net_version' })).toBe('137');
    expect(provider.selectedAddress).toBe(EVM.accounts[0]);
  });

  it('eth_requestAccounts connects inside the click (gesture first)', async () => {
    const { bridge, calls, gestures } = fakeBridge(() => EVM);
    const provider = createEvmProvider(bridge);
    const pending = provider.request({ method: 'eth_requestAccounts' });
    expect(gestures()).toBe(1);
    expect(await pending).toEqual(EVM.accounts);
    expect(calls).toEqual([{ op: 'connect', namespace: 'eip155' }]);
  });

  it('normalizes calls before forwarding them', async () => {
    const { bridge, calls, set } = fakeBridge();
    set({ eip155: EVM });
    const provider = createEvmProvider(bridge);
    await provider.request({ method: 'personal_sign', params: ['hello', EVM.accounts[0]] });
    await provider.request({ method: 'personal_sign', params: ['0x68', EVM.accounts[0]] });
    await provider.request({ method: 'eth_signTypedData_v4', params: [EVM.accounts[0], { types: {} }] });
    await provider.request({ method: 'eth_sendTransaction', params: [{ from: EVM.accounts[0] }] });
    await provider.request({ method: 'eth_sendTransaction', params: [{ from: EVM.accounts[0], chainId: '0x5' }] });
    expect(calls.map((c) => (c.op === 'call' ? c.params : undefined))).toEqual([
      ['0x68656c6c6f', EVM.accounts[0]],
      ['0x68', EVM.accounts[0]],
      [EVM.accounts[0], '{"types":{}}'],
      [{ from: EVM.accounts[0], chainId: '0x1' }],
      [{ from: EVM.accounts[0], chainId: '0x5' }],
    ]);
  });

  it('routes reads to the node and refuses what WalletPair does not offer', async () => {
    const { bridge, calls } = fakeBridge(() => '0x10');
    const provider = createEvmProvider(bridge);
    expect(await provider.request({ method: 'eth_blockNumber' })).toBe('0x10');
    expect(calls[0]).toEqual({ op: 'rpc', method: 'eth_blockNumber', params: undefined });
    for (const method of ['eth_sign', 'eth_signTypedData_v3', 'wallet_requestPermissions', 'eth_sendRawTransaction']) {
      await expect(provider.request({ method })).rejects.toMatchObject({ code: 4200 });
    }
  });

  it('wallet_revokePermissions disconnects the site only', async () => {
    const { bridge, calls } = fakeBridge();
    expect(await createEvmProvider(bridge).request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] })).toBeNull();
    expect(calls).toEqual([{ op: 'disconnect', namespace: 'eip155' }]);
  });

  it('emits events after the state is in place, only for real changes', () => {
    const { bridge, set } = fakeBridge();
    const provider = createEvmProvider(bridge);
    const events: unknown[][] = [];
    for (const name of ['connect', 'chainChanged', 'accountsChanged', 'disconnect']) {
      provider.on(name, (value: unknown) =>
        events.push([name, value instanceof ProviderRpcError ? value.code : value, provider.chainId]),
      );
    }
    set({ eip155: EVM });
    set({ eip155: EVM });
    set({ eip155: { ...EVM, chain: 'eip155:137' } });
    set({});
    set({}, false);
    expect(events).toEqual([
      ['connect', { chainId: '0x1' }, '0x1'],
      ['accountsChanged', EVM.accounts, '0x1'],
      ['chainChanged', '0x89', '0x89'],
      ['accountsChanged', [], '0x1'],
      ['disconnect', 4900, '0x1'],
    ]);
  });
});

describe('TRON', () => {
  const raw = '0a020a1b2208010203040506070840c0ab9b8ef89d035a68080112640a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412330a1541f39fd6e51aad88f6f4ce6ab8827279cfffb922661215417303efe1d0ffd02f8b1ba7c99e29c95b7cfd0e8b18e807';
  const txID = bytesToHex(sha256(Uint8Array.from(raw.match(/../g)!.map((h) => parseInt(h, 16)))));
  const tx = { txID, raw_data_hex: raw, visible: false, raw_data: {} };

  it('tronWeb is false until the site is approved, then signs through tron_signTransaction', async () => {
    const { bridge, calls, set } = fakeBridge(() => ({ signature: 'ab'.repeat(65) }));
    const { provider, tronWeb } = createTron(bridge);
    expect(provider.tronWeb).toBe(false);
    set({ tron: TRON });
    expect(provider.tronWeb).toBe(tronWeb);
    expect(tronWeb.defaultAddress.base58).toBe(TRON.accounts[0]);
    expect(tronWeb.defaultAddress.hex).toBe(TronWeb.address.toHex(TRON.accounts[0]).toLowerCase());
    const signed = await tronWeb.trx.sign(tx);
    expect(signed.signature).toEqual(['ab'.repeat(65)]);
    expect(calls).toEqual([{ op: 'call', method: 'tron_signTransaction', params: { account: TRON.accounts[0], transaction: raw } }]);
  });

  it('refuses a txID that is not the hash of raw_data_hex, V1 messages and typed data', async () => {
    const { bridge, calls, set } = fakeBridge();
    set({ tron: TRON });
    const { tronWeb } = createTron(bridge);
    await expect(tronWeb.trx.sign({ ...tx, txID: '00'.repeat(32) })).rejects.toBe('Invalid transaction provided');
    await expect(tronWeb.trx.sign('0x' + 'ab'.repeat(32))).rejects.toMatchObject({ code: 4200 });
    await expect(tronWeb.trx.signMessage()).rejects.toMatchObject({ code: 4200 });
    await expect(tronWeb.trx._signTypedData()).rejects.toMatchObject({ code: 4200 });
    await expect(tronWeb.trx.signMessageV2(new Uint8Array(1))).rejects.toMatchObject({ code: -32602 });
    expect(calls).toEqual([]);
  });

  it('signMessageV2 sends UTF-8 bytes and returns a 0x signature; rejection is the string TRON pages expect', async () => {
    let reject = false;
    const { bridge, calls, set } = fakeBridge(() => (reject ? new ProviderRpcError(4001, 'no') : { signature: 'cd'.repeat(65) }));
    set({ tron: TRON });
    const { tronWeb } = createTron(bridge);
    expect(await tronWeb.trx.signMessageV2('hé')).toBe(`0x${'cd'.repeat(65)}`);
    expect(calls[0]).toEqual({ op: 'call', method: 'tron_signMessage', params: { account: TRON.accounts[0], message: '68c3a9' } });
    reject = true;
    await expect(tronWeb.trx.signMessageV2('x')).rejects.toBe(DECLINED);
  });

  it('TIP-1193 requests, the legacy code results, and events', async () => {
    let decline = false;
    const { bridge, calls, set } = fakeBridge((call) => (call.op === 'connect' ? (decline ? new ProviderRpcError(4001, 'no') : TRON) : null));
    const { provider, tronLink } = createTron(bridge);
    const events: unknown[][] = [];
    provider.on('connect', (v: unknown) => events.push(['connect', v]));
    provider.on('accountsChanged', (v: unknown) => events.push(['accountsChanged', v]));
    provider.on('chainChanged', (v: unknown) => events.push(['chainChanged', v]));
    expect(await provider.request({ method: 'eth_requestAccounts' })).toEqual(TRON.accounts);
    expect(await tronLink.request({ method: 'tron_requestAccounts' })).toEqual({ code: 200, message: 'User allowed the request.' });
    decline = true;
    expect(await tronLink.request({ method: 'tron_requestAccounts' })).toEqual({ code: 4001, message: 'User rejected the request' });
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xcd8690dc' }] });
    expect(calls.at(-1)).toEqual({ op: 'call', method: 'tron_switchChain', params: { chain: 'tron:3448148188' } });
    await expect(provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: 'nile' }] })).rejects.toMatchObject({ code: -32602 });
    await expect(provider.request({ method: 'tron_signMessage' })).rejects.toMatchObject({ code: 4200 });
    expect(await provider.request({ method: 'eth_chainId' })).toBe('0x2b6653dc');
    expect(await provider.request({ method: 'wallet_revokePermissions' })).toBeNull();
    expect(calls.at(-1)).toEqual({ op: 'disconnect', namespace: 'tron' });
    set({ tron: TRON });
    set({ tron: { ...TRON, chain: 'tron:3448148188' } });
    expect(events).toEqual([
      ['connect', { chainId: '0x2b6653dc' }],
      ['accountsChanged', TRON.accounts],
      ['chainChanged', { chainId: '0xcd8690dc' }],
    ]);
  });
});

describe('Solana wallet', () => {
  type Feature = Record<string, (...args: never[]) => Promise<never>>;
  const feature = (wallet: ReturnType<typeof createSolanaWallet>, name: string) => (wallet.features as unknown as Record<string, Feature>)[name];

  it('is a Wallet Standard wallet with the features wallet adapters require', () => {
    const wallet = createSolanaWallet(fakeBridge().bridge);
    expect(wallet.version).toBe('1.0.0');
    expect(wallet.icon).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(wallet.chains).toEqual(['solana:mainnet', 'solana:devnet', 'solana:testnet']);
    expect(Object.keys(wallet.features).sort()).toEqual(
      ['solana:signAndSendTransaction', 'solana:signMessage', 'solana:signTransaction', 'standard:connect', 'standard:disconnect', 'standard:events'].sort(),
    );
  });

  it('keeps account objects while addresses stay the same, and reports changes', async () => {
    const { bridge, set } = fakeBridge(() => SOLANA);
    const wallet = createSolanaWallet(bridge);
    const changes: unknown[] = [];
    (feature(wallet, 'standard:events') as unknown as { on: (e: string, l: (p: unknown) => void) => void }).on('change', (p) => changes.push(p));
    set({ solana: SOLANA });
    const first = wallet.accounts[0];
    expect(Object.isFrozen(first)).toBe(true);
    set({ solana: { ...SOLANA, chain: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' } });
    expect(wallet.accounts[0]).toBe(first);
    set({});
    expect(wallet.accounts).toEqual([]);
    expect(changes).toHaveLength(2);
  });

  it('silent connect never gestures', async () => {
    const { bridge, calls, gestures } = fakeBridge(() => null);
    const wallet = createSolanaWallet(bridge);
    await (feature(wallet, 'standard:connect') as unknown as { connect: (i: unknown) => Promise<unknown> }).connect({ silent: true });
    expect(gestures()).toBe(0);
    expect(calls).toEqual([{ op: 'connect', namespace: 'solana', silent: true }]);
  });

  it('signs runs of inputs with one call each, and maps clusters to chain IDs', async () => {
    const { bridge, calls, set } = fakeBridge((call) =>
      call.op === 'call' ? { transactions: (call.params as { transactions: string[] }).transactions } : null,
    );
    set({ solana: SOLANA });
    const wallet = createSolanaWallet(bridge);
    const account = wallet.accounts[0];
    const other = { ...account, address: '11111111111111111111111111111112' };
    const sign = (feature(wallet, 'solana:signTransaction') as unknown as { signTransaction: (...i: unknown[]) => Promise<unknown[]> }).signTransaction;
    const tx = (n: number) => Uint8Array.of(n);
    const out = await sign(
      { account, transaction: tx(1), chain: 'solana:devnet' },
      { account, transaction: tx(2), chain: 'solana:devnet' },
      { account: other, transaction: tx(3) },
    );
    expect(out).toEqual([{ signedTransaction: tx(1) }, { signedTransaction: tx(2) }, { signedTransaction: tx(3) }]);
    expect(calls).toEqual([
      { op: 'call', method: 'solana_signTransactions', params: { account: account.address, transactions: [base64Encode(tx(1)), base64Encode(tx(2))], chain: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' } },
      { op: 'call', method: 'solana_signTransactions', params: { account: other.address, transactions: [base64Encode(tx(3))] } },
    ]);
    await expect(sign({ account, transaction: tx(1), chain: 'solana:localnet' })).rejects.toMatchObject({ code: 4901 });
  });
});
