// The page providers against a scripted bridge: how each network's API maps
// onto WalletPair calls (spec/networks/*.md §3).

import { describe, expect, it } from 'vitest';
import type { Bridge } from '../src/lib/inpage/bridge';
import { ProviderRpcError } from '../src/lib/inpage/bridge';
import { createEvmProvider } from '../src/lib/inpage/evm';
import type { PageCall, SiteState } from '../src/lib/types';

const EVM = { chain: 'eip155:1', accounts: ['0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'] };

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
