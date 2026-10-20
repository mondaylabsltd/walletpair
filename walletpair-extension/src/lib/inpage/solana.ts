// Solana for pages: a Wallet Standard wallet (spec/networks/solana.md §3).

import { base58Decode, base64Decode, base64Encode } from '../walletpair/codec';
import { SOLANA_CLUSTERS } from '../walletpair/networks/solana';
import type { NamespaceState } from '../walletpair/protocol';
import { ProviderRpcError, type Bridge } from './bridge';
import { ICON, NAME } from './icon';

const CHAINS = SOLANA_CLUSTERS.map((c) => c.standard);
const VERSIONS = ['legacy', 0] as const;
const FEATURES = [
  'standard:connect',
  'standard:disconnect',
  'standard:events',
  'solana:signTransaction',
  'solana:signAndSendTransaction',
  'solana:signMessage',
] as const;
/** At most this many transactions per solana_signTransactions (§2.1). */
const BATCH = 16;

interface Account {
  readonly address: string;
  readonly publicKey: Uint8Array;
  readonly chains: readonly string[];
  readonly features: readonly string[];
}

interface TransactionInput {
  account: Account;
  transaction: Uint8Array;
  chain?: string;
  options?: Record<string, unknown>;
}

/** Wallet Standard `solana:…` cluster → CAIP-2 chain ID (§1). */
function chainOf(standard: string): string {
  const cluster = SOLANA_CLUSTERS.find((c) => c.standard === standard);
  if (!cluster) throw new ProviderRpcError(4901, `${standard} is not supported`);
  return cluster.chain;
}

function makeAccount(address: string): Account {
  return Object.freeze({
    address,
    publicKey: base58Decode(address)!,
    chains: Object.freeze([...CHAINS]),
    features: Object.freeze([...FEATURES]),
  });
}

export function createSolanaWallet(bridge: Bridge) {
  const listeners = new Set<(properties: { accounts?: readonly Account[] }) => void>();
  let accounts: readonly Account[] = [];

  /** Keeps the same account objects while the addresses are unchanged: applications compare them by identity. */
  function refresh(): boolean {
    const addresses = bridge.state.solana?.accounts ?? [];
    if (addresses.join() === accounts.map((a) => a.address).join()) return false;
    const known = new Map(accounts.map((a) => [a.address, a]));
    accounts = Object.freeze(addresses.map((address) => known.get(address) ?? makeAccount(address)));
    return true;
  }

  const call = <T>(method: string, params: Record<string, unknown>) => bridge.call<T>({ op: 'call', method, params: params as never });

  async function signTransaction(...inputs: TransactionInput[]) {
    const outputs: { signedTransaction: Uint8Array }[] = [];
    // One call per run of inputs with the same account and chain, so that
    // signAllTransactions is one prompt in the Wallet.
    for (let start = 0; start < inputs.length; ) {
      const { account, chain } = inputs[start];
      let end = start + 1;
      while (end < inputs.length && end - start < BATCH && inputs[end].account.address === account.address && inputs[end].chain === chain) end++;
      const params: Record<string, unknown> = {
        account: account.address,
        transactions: inputs.slice(start, end).map((input) => base64Encode(input.transaction)),
      };
      if (chain !== undefined) params.chain = chainOf(chain);
      const { transactions } = await call<{ transactions: string[] }>('solana_signTransactions', params);
      for (const signed of transactions) outputs.push({ signedTransaction: base64Decode(signed)! });
      start = end;
    }
    return outputs;
  }

  async function signAndSendTransaction(...inputs: TransactionInput[]) {
    const outputs: { signature: Uint8Array }[] = [];
    for (const { account, transaction, chain, options } of inputs) {
      if (chain === undefined) throw new ProviderRpcError(-32602, 'chain is required');
      const params: Record<string, unknown> = { account: account.address, transaction: base64Encode(transaction), chain: chainOf(chain) };
      if (options) {
        const kept = Object.fromEntries(
          ['preflightCommitment', 'commitment', 'skipPreflight', 'maxRetries', 'minContextSlot']
            .filter((key) => options[key] !== undefined)
            .map((key) => [key, options[key]]),
        );
        if (Object.keys(kept).length) params.options = kept;
      }
      const { signature } = await call<{ signature: string }>('solana_signAndSendTransaction', params);
      outputs.push({ signature: base64Decode(signature)! });
    }
    return outputs;
  }

  async function signMessage(...inputs: { account: Account; message: Uint8Array }[]) {
    const outputs: { signedMessage: Uint8Array; signature: Uint8Array; signatureType: 'ed25519' }[] = [];
    for (const { account, message } of inputs) {
      const { signature } = await call<{ signature: string }>('solana_signMessage', { account: account.address, message: base64Encode(message) });
      outputs.push({ signedMessage: message, signature: base64Decode(signature)!, signatureType: 'ed25519' });
    }
    return outputs;
  }

  const wallet = {
    version: '1.0.0' as const,
    name: NAME,
    icon: ICON,
    chains: Object.freeze([...CHAINS]),
    get accounts() {
      return accounts;
    },
    features: Object.freeze({
      'standard:connect': {
        version: '1.0.0',
        async connect(input?: { silent?: boolean }) {
          const silent = input?.silent === true;
          if (!silent) bridge.gesture();
          await bridge.call<NamespaceState | null>({ op: 'connect', namespace: 'solana', silent });
          refresh();
          return { accounts };
        },
      },
      'standard:disconnect': {
        version: '1.0.0',
        async disconnect() {
          await bridge.call({ op: 'disconnect', namespace: 'solana' });
        },
      },
      'standard:events': {
        version: '1.0.0',
        on(event: string, listener: (properties: { accounts?: readonly Account[] }) => void) {
          if (event !== 'change') return () => {};
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: VERSIONS, signTransaction },
      'solana:signAndSendTransaction': { version: '1.0.0', supportedTransactionVersions: VERSIONS, signAndSendTransaction },
      'solana:signMessage': { version: '1.0.0', signMessage },
    }),
  };

  bridge.subscribe(() => {
    if (!refresh()) return;
    for (const listener of [...listeners]) {
      try {
        listener({ accounts });
      } catch {
        // An application's listener must not break the wallet.
      }
    }
  });

  return wallet;
}

type Register = (wallet: unknown) => () => void;

/** The register event of the Wallet Standard, which forbids being cancelled. */
class RegisterWalletEvent extends Event {
  readonly #detail: (api: { register: Register }) => void;
  get detail() {
    return this.#detail;
  }
  constructor(callback: (api: { register: Register }) => void) {
    super('wallet-standard:register-wallet', { bubbles: false, cancelable: false, composed: false });
    this.#detail = callback;
  }
  preventDefault(): never {
    throw new Error('preventDefault cannot be called');
  }
  stopImmediatePropagation(): never {
    throw new Error('stopImmediatePropagation cannot be called');
  }
  stopPropagation(): never {
    throw new Error('stopPropagation cannot be called');
  }
}

/** Registers with applications that load before or after this script (Wallet Standard). */
export function installSolanaWallet(bridge: Bridge): ReturnType<typeof createSolanaWallet> {
  const wallet = createSolanaWallet(bridge);
  const callback = ({ register }: { register: Register }) => register(wallet);
  try {
    window.dispatchEvent(new RegisterWalletEvent(callback));
  } catch {
    // Registration must never break the page.
  }
  window.addEventListener('wallet-standard:app-ready', (event) => {
    try {
      callback((event as CustomEvent<{ register: Register }>).detail);
    } catch {
      // Same.
    }
  });
  return wallet;
}
