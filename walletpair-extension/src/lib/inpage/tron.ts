// TRON for pages (spec/networks/tron.md §3): a TIP-1193 provider announced with
// TIP-6963, and the tronWeb signing object TRON applications and adapters use.

import { EXTENSION_RDNS } from '../constants';
import { bytesToHex, hexToBytes } from '../walletpair/codec';
import { tronChainId, tronChainOf, tronHexAddress } from '../walletpair/networks/tron';
import type { NamespaceState } from '../walletpair/protocol';
import { ProviderRpcError, type Bridge } from './bridge';
import { ICON, NAME } from './icon';

type Listener = (...args: unknown[]) => void;

/** What TRON applications receive when the user declines a signature. */
export const DECLINED = 'Confirmation declined by user';

/** Node hosts TronLink reports per network, which some applications read to tell networks apart. */
const HOSTS: Record<string, string> = {
  'tron:728126428': 'https://api.trongrid.io',
  'tron:2494104990': 'https://api.shasta.trongrid.io',
  'tron:3448148188': 'https://nile.trongrid.io',
};

interface TronTransaction {
  txID: string;
  raw_data_hex: string;
  signature?: string[];
  raw_data?: { contract?: { Permission_id?: number }[] };
  [key: string]: unknown;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)));
}

export function createTron(bridge: Bridge) {
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
  const state = (): NamespaceState | undefined => bridge.state.tron;
  const account = (): string => {
    const current = state()?.accounts[0];
    if (!current) throw new ProviderRpcError(4100, 'Not connected');
    return current;
  };

  /** Resolves with the Wallet's answer; a user rejection rejects with the string TRON pages expect. */
  async function forward<T>(method: string, params: Record<string, string>): Promise<T> {
    try {
      return await bridge.call<T>({ op: 'call', method, params });
    } catch (error) {
      if ((error as ProviderRpcError).code === 4001) throw DECLINED;
      throw error;
    }
  }

  async function signTransaction(transaction: TronTransaction): Promise<TronTransaction> {
    const raw = typeof transaction?.raw_data_hex === 'string' ? hexToBytes(transaction.raw_data_hex) : null;
    if (!raw || typeof transaction.txID !== 'string' || (await sha256Hex(raw)) !== transaction.txID.toLowerCase()) {
      throw 'Invalid transaction provided';
    }
    const { signature } = await forward<{ signature: string }>('tron_signTransaction', {
      account: account(),
      transaction: transaction.raw_data_hex.toLowerCase(),
    });
    return { ...transaction, signature: [...(transaction.signature ?? []), signature] };
  }

  const unsupported = (what: string) => () => Promise.reject(new ProviderRpcError(4200, `${what} is not supported by WalletPair`));

  const node = () => ({ host: HOSTS[state()?.chain ?? ''] ?? '' });

  /** The signing object (§3); it neither queries nor broadcasts. */
  const tronWeb = {
    get ready() {
      return Boolean(state());
    },
    defaultAddress: { base58: false as string | false, hex: false as string | false },
    get fullNode() {
      return node();
    },
    get solidityNode() {
      return node();
    },
    get eventServer() {
      return node();
    },
    trx: {
      sign(transaction: TronTransaction | string): Promise<TronTransaction> {
        // A string is the legacy V1 message format, which is refused (§2.2).
        if (typeof transaction === 'string') return unsupported('V1 message signing')() as Promise<never>;
        return signTransaction(transaction);
      },
      signTransaction(transaction: TronTransaction): Promise<TronTransaction> {
        return tronWeb.trx.sign(transaction);
      },
      multiSign(transaction: TronTransaction, _privateKey?: unknown, permissionId?: number): Promise<TronTransaction> {
        const current = transaction?.raw_data?.contract?.[0]?.Permission_id ?? 0;
        if (permissionId !== undefined && permissionId !== current) {
          return Promise.reject(new ProviderRpcError(-32602, 'Set Permission_id on the transaction before multiSign'));
        }
        return signTransaction(transaction);
      },
      async signMessageV2(message: unknown): Promise<string> {
        if (typeof message !== 'string') throw new ProviderRpcError(-32602, 'signMessageV2 takes a string');
        const hex = bytesToHex(new TextEncoder().encode(message));
        const { signature } = await forward<{ signature: string }>('tron_signMessage', { account: account(), message: hex });
        return `0x${signature}`;
      },
      signMessage: unsupported('V1 message signing'),
      _signTypedData: unsupported('Typed data signing'),
      signTypedData: unsupported('Typed data signing'),
    },
  };

  async function requestAccounts(): Promise<string[]> {
    bridge.gesture();
    const granted = await bridge.call<NamespaceState>({ op: 'connect', namespace: 'tron' });
    return [...granted.accounts];
  }

  /** TIP-1193 (§3). */
  const provider = {
    isWalletPair: true,
    get tronWeb() {
      return state() ? tronWeb : false;
    },
    async request(args: { method: string; params?: unknown }): Promise<unknown> {
      switch (args?.method) {
        case 'eth_requestAccounts':
          return requestAccounts();
        case 'tron_requestAccounts':
          return legacyRequestAccounts();
        case 'eth_chainId':
          return tronChainId(state()?.chain ?? 'tron:728126428');
        case 'wallet_revokePermissions':
          await bridge.call({ op: 'disconnect', namespace: 'tron' });
          return null;
        case 'wallet_switchEthereumChain': {
          const target = Array.isArray(args.params) ? (args.params[0] as { chainId?: unknown })?.chainId : undefined;
          const chain = typeof target === 'string' ? tronChainOf(target) : null;
          if (!chain) throw new ProviderRpcError(-32602, 'Invalid chainId');
          await bridge.call({ op: 'call', method: 'tron_switchChain', params: { chain } });
          return null;
        }
      }
      throw new ProviderRpcError(4200, `${args?.method} is not supported`);
    },
    on(event: string, listener: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return provider;
    },
    removeListener(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener);
      return provider;
    },
  };

  /** TronLink's legacy request, which resolves with a code instead of rejecting. */
  async function legacyRequestAccounts(): Promise<{ code: number; message: string }> {
    try {
      await requestAccounts();
      return { code: 200, message: 'User allowed the request.' };
    } catch (error) {
      if ((error as ProviderRpcError).code === 4001) return { code: 4001, message: 'User rejected the request' };
      throw error;
    }
  }

  const tronLink = {
    get ready() {
      return Boolean(state());
    },
    get tronWeb() {
      return state() ? tronWeb : false;
    },
    request: (args: { method: string; params?: unknown }) => provider.request(args),
  };

  const updateAddress = () => {
    const current = state();
    tronWeb.defaultAddress = current
      ? { base58: current.accounts[0], hex: tronHexAddress(current.accounts[0]) ?? false }
      : { base58: false, hex: false };
  };
  updateAddress();

  bridge.subscribe((previous, wasLive) => {
    const before = previous.tron;
    const after = state();
    // defaultAddress first: adapters re-read it when they hear an event.
    updateAddress();
    if (!before && after) emit('connect', { chainId: tronChainId(after.chain) });
    if (before && after && before.chain !== after.chain) emit('chainChanged', { chainId: tronChainId(after.chain) });
    if ((before?.accounts ?? []).join() !== (after?.accounts ?? []).join()) emit('accountsChanged', [...(after?.accounts ?? [])]);
    if (wasLive && !bridge.live) emit('disconnect', new ProviderRpcError(4900, 'Disconnected'));
  });

  return { provider, tronWeb, tronLink };
}

/** Announces the provider (TIP-6963) and installs the TRON globals no other wallet has taken. */
export function installTron(bridge: Bridge) {
  const { provider, tronWeb, tronLink } = createTron(bridge);
  const detail = Object.freeze({
    info: Object.freeze({ uuid: crypto.randomUUID(), name: NAME, icon: ICON, rdns: EXTENSION_RDNS }),
    provider,
  });
  const announce = () => window.dispatchEvent(new CustomEvent('TIP6963:announceProvider', { detail }));
  window.addEventListener('TIP6963:requestProvider', announce);
  announce();

  const page = window as unknown as Record<string, unknown>;
  const define = (name: string, value: unknown) => {
    if (page[name] === undefined) Object.defineProperty(window, name, { value, writable: true, configurable: true });
  };
  define('tron', provider);
  define('tronLink', tronLink);
  define('tronWeb', tronWeb);
  return provider;
}
