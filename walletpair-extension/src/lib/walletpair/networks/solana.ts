// Solana, namespace solana: spec/networks/solana.md.

import { base58Decode, base64Decode, isUtf8 } from '../codec';
import { ErrorCode, isObject, rpcError, type NamespaceState, type Params, type RpcError } from '../protocol';
import { isTransactionMessage, parseTransaction, signerIndex } from './solana-transaction';
import type { Network, WalletFunction } from './types';

/** Clusters: CAIP-2 chain ID and Wallet Standard identifier (§1). */
export const SOLANA_CLUSTERS = [
  { chain: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', standard: 'solana:mainnet' },
  { chain: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', standard: 'solana:devnet' },
  { chain: 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z', standard: 'solana:testnet' },
] as const;

export const isSolanaChain = (chain: string): boolean => SOLANA_CLUSTERS.some((c) => c.chain === chain);

/** The 32-byte public key of a base58 address, or null. */
export function solanaPublicKey(address: string): Uint8Array | null {
  if (address.length < 32 || address.length > 44) return null;
  const bytes = base58Decode(address);
  return bytes && bytes.length === 32 ? bytes : null;
}

export const isSolanaAccount = (account: string): boolean => solanaPublicKey(account) !== null;

const MAX_MESSAGE_BYTES = 65_536;
const COMMITMENTS = ['processed', 'confirmed', 'finalized'];

const invalid = (message = 'Invalid params'): RpcError => rpcError(ErrorCode.InvalidParams, message);

function object(params: Params | undefined): Record<string, unknown> | null {
  return isObject(params) ? params : null;
}

/** Account and chain checks shared by all three functions. */
function checkAccount(
  input: Record<string, unknown>,
  state: NamespaceState,
  chain: 'none' | 'optional' | 'required',
): RpcError | null {
  if (typeof input.account !== 'string' || !isSolanaAccount(input.account)) return invalid('Invalid account');
  const named = chain === 'none' ? undefined : input.chain;
  if (chain === 'required' && named === undefined) return invalid('chain is required');
  if (named !== undefined && (typeof named !== 'string' || !isSolanaChain(named))) return invalid('Invalid chain');
  if (!state.accounts.includes(input.account)) return rpcError(ErrorCode.Unauthorized, 'Account is not approved');
  if (named !== undefined && named !== state.chain) return rpcError(ErrorCode.ChainMismatch, 'Chain is not active');
  return null;
}

/** A transaction the account can sign, or an error message. */
function checkTransaction(value: unknown, account: string): string | null {
  const bytes = typeof value === 'string' ? base64Decode(value) : null;
  if (!bytes) return 'Transaction is not base64';
  const tx = parseTransaction(bytes);
  if (!tx) return 'Not a legacy or version 0 transaction';
  if (signerIndex(tx, solanaPublicKey(account)!) < 0) return 'Account is not a signer of the transaction';
  return null;
}

const functions: Record<string, WalletFunction> = {
  solana_signTransactions: {
    check(params, state) {
      const input = object(params);
      if (!input) return invalid();
      const refused = checkAccount(input, state, 'optional');
      if (refused) return refused;
      const { transactions } = input;
      if (!Array.isArray(transactions) || transactions.length < 1 || transactions.length > 16) return invalid();
      for (const tx of transactions) {
        const problem = checkTransaction(tx, input.account as string);
        if (problem) return invalid(problem);
      }
      return null;
    },
  },

  solana_signAndSendTransaction: {
    check(params, state) {
      const input = object(params);
      if (!input) return invalid();
      const refused = checkAccount(input, state, 'required');
      if (refused) return refused;
      const problem = checkTransaction(input.transaction, input.account as string);
      if (problem) return invalid(problem);
      const { options } = input;
      if (options === undefined) return null;
      if (!isObject(options)) return invalid('Invalid options');
      for (const key of ['preflightCommitment', 'commitment'] as const) {
        if (options[key] !== undefined && !COMMITMENTS.includes(options[key] as string)) return invalid(`Invalid ${key}`);
      }
      if (options.skipPreflight !== undefined && typeof options.skipPreflight !== 'boolean') {
        return invalid('Invalid skipPreflight');
      }
      for (const key of ['maxRetries', 'minContextSlot'] as const) {
        const value = options[key];
        if (value !== undefined && !(Number.isSafeInteger(value) && (value as number) >= 0)) return invalid(`Invalid ${key}`);
      }
      return null;
    },
  },

  solana_signMessage: {
    check(params, state) {
      const input = object(params);
      if (!input) return invalid();
      const refused = checkAccount(input, state, 'none');
      if (refused) return refused;
      const bytes = typeof input.message === 'string' ? base64Decode(input.message) : null;
      if (!bytes || bytes.length < 1 || bytes.length > MAX_MESSAGE_BYTES) return invalid('Invalid message');
      if (!isUtf8(bytes)) return invalid('Message is not UTF-8 text');
      if (parseTransaction(bytes) || isTransactionMessage(bytes)) return invalid('Message is a transaction');
      return null;
    },
  },
};

export const solana: Network = {
  namespace: 'solana',
  isChain: isSolanaChain,
  isAccount: isSolanaAccount,
  functions,
};
