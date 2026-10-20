// The EIP-1193 provider for EVM chains (spec/networks/evm.md §3).

import { EXTENSION_RDNS } from '../constants';
import { READ_ONLY_METHODS } from '../evm/read-methods';
import { chainIdOf, evm } from '../walletpair/networks/evm';
import type { NamespaceState, Params } from '../walletpair/protocol';
import { ProviderRpcError, type Bridge } from './bridge';
import { ICON, NAME } from './icon';

type Listener = (...args: unknown[]) => void;

interface RequestArguments {
  method: string;
  params?: unknown;
}

const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;

function utf8Hex(text: string): string {
  return `0x${Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Brings a call into the form spec/networks/evm.md §2 forwards. */
function normalize(method: string, params: unknown, state: NamespaceState | undefined): Params | undefined {
  if (!Array.isArray(params)) return params as Params | undefined;
  const p = [...params];
  if (method === 'personal_sign' && typeof p[0] === 'string' && !HEX.test(p[0])) p[0] = utf8Hex(p[0]);
  if (method === 'eth_signTypedData_v4' && p[1] && typeof p[1] === 'object') p[1] = JSON.stringify(p[1]);
  if (method === 'eth_sendTransaction' && p[0] && typeof p[0] === 'object' && state) {
    const tx = p[0] as Record<string, unknown>;
    // Pins the chain the page believes is active (§2, "Active chain").
    if (tx.chainId === undefined) p[0] = { ...tx, chainId: chainIdOf(state.chain) };
  }
  return p as Params;
}

export function createEvmProvider(bridge: Bridge) {
  const listeners = new Map<string, Set<Listener>>();
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of [...(listeners.get(event) ?? [])]) {
      try {
        listener(...args);
      } catch {
        // A page's listener must not break the provider.
      }
    }
  };
  const state = () => bridge.state.eip155;
  const accounts = () => [...(state()?.accounts ?? [])];
  const chainId = () => chainIdOf(state()?.chain ?? 'eip155:1');

  async function request(args: RequestArguments): Promise<unknown> {
    if (!args || typeof args.method !== 'string') throw new ProviderRpcError(-32600, 'Invalid request');
    const { method, params } = args;
    switch (method) {
      case 'eth_accounts':
        return accounts();
      case 'eth_chainId':
        return chainId();
      case 'net_version':
        return BigInt(chainId()).toString(10);
      case 'eth_requestAccounts': {
        bridge.gesture();
        const granted = await bridge.call<NamespaceState>({ op: 'connect', namespace: 'eip155' });
        return [...granted.accounts];
      }
      case 'wallet_revokePermissions':
        await bridge.call({ op: 'disconnect', namespace: 'eip155' });
        return null;
    }
    if (Object.hasOwn(evm.functions, method)) {
      return bridge.call({ op: 'call', method, params: normalize(method, params, state()) });
    }
    if (READ_ONLY_METHODS.has(method)) return bridge.call({ op: 'rpc', method, params });
    throw new ProviderRpcError(4200, `${method} is not supported`);
  }

  const provider = {
    isWalletPair: true,
    isMetaMask: false,
    request,
    on(event: string, listener: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return provider;
    },
    addListener(event: string, listener: Listener) {
      return provider.on(event, listener);
    },
    once(event: string, listener: Listener) {
      const wrapped: Listener = (...args) => {
        provider.removeListener(event, wrapped);
        listener(...args);
      };
      return provider.on(event, wrapped);
    },
    removeListener(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener);
      return provider;
    },
    off(event: string, listener: Listener) {
      return provider.removeListener(event, listener);
    },
    removeAllListeners(event?: string) {
      if (event) listeners.delete(event);
      else listeners.clear();
      return provider;
    },
    listenerCount(event: string) {
      return listeners.get(event)?.size ?? 0;
    },
    /** Reads can always be served, through the extension's node endpoints. */
    isConnected() {
      return true;
    },
    // Legacy members some older pages still use.
    enable() {
      return request({ method: 'eth_requestAccounts' });
    },
    sendAsync(payload: { id?: number; method: string; params?: unknown }, callback: (error: unknown, response?: unknown) => void) {
      request(payload).then(
        (result) => callback(null, { id: payload.id, jsonrpc: '2.0', result }),
        (error) => callback(error),
      );
    },
    send(methodOrPayload: string | { id?: number; method: string; params?: unknown }, paramsOrCallback?: unknown) {
      if (typeof methodOrPayload === 'string') return request({ method: methodOrPayload, params: paramsOrCallback });
      if (typeof paramsOrCallback === 'function') {
        return provider.sendAsync(methodOrPayload, paramsOrCallback as (error: unknown, response?: unknown) => void);
      }
      return request(methodOrPayload);
    },
    get selectedAddress() {
      return accounts()[0] ?? null;
    },
    get chainId() {
      return chainId();
    },
    get networkVersion() {
      return BigInt(chainId()).toString(10);
    },
  };

  // EIP-1193 events, after the state they report is in place (§3).
  bridge.subscribe((previous, wasLive) => {
    const before = previous.eip155;
    const after = state();
    if (!before && after) emit('connect', { chainId: chainIdOf(after.chain) });
    if (before && after && before.chain !== after.chain) emit('chainChanged', chainIdOf(after.chain));
    if ((before?.accounts ?? []).join() !== (after?.accounts ?? []).join()) emit('accountsChanged', accounts());
    if (wasLive && !bridge.live) emit('disconnect', new ProviderRpcError(4900, 'Disconnected'));
  });

  return provider;
}

/** Announces the provider (EIP-6963), and installs it as window.ethereum when no other wallet has. */
export function installEvmProvider(bridge: Bridge) {
  const provider = createEvmProvider(bridge);
  const detail = Object.freeze({
    info: Object.freeze({ uuid: crypto.randomUUID(), name: NAME, icon: ICON, rdns: EXTENSION_RDNS }),
    provider,
  });
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
  window.addEventListener('eip6963:requestProvider', announce);
  announce();

  const page = window as unknown as Record<string, unknown>;
  if (page.ethereum === undefined) {
    // Writable and configurable, so a wallet injected later can still take the name.
    Object.defineProperty(window, 'ethereum', { value: provider, writable: true, configurable: true });
  }
  return provider;
}
