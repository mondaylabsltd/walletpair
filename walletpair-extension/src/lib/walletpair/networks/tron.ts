// TRON, namespace tron: spec/networks/tron.md.

import { sha256 } from '@noble/hashes/sha2.js';
import { base58Decode, base58Encode, bytesToHex, hexToBytes } from '../codec';
import { ErrorCode, isObject, rpcError, type NamespaceState, type Params, type RpcError } from '../protocol';
import { parseTronRaw } from './tron-transaction';
import type { Network, WalletFunction } from './types';

/** Networks: CAIP-2 chain ID and TIP-1193 chainId (§1). */
export const TRON_NETWORKS = [
  { chain: 'tron:728126428', chainId: '0x2b6653dc', name: 'Mainnet' },
  { chain: 'tron:2494104990', chainId: '0x94a9059e', name: 'Shasta' },
  { chain: 'tron:3448148188', chainId: '0xcd8690dc', name: 'Nile' },
] as const;

/** `tron:` and a decimal chain ID that fits in 32 bits, without leading zeros. */
export function isTronChain(chain: string): boolean {
  return /^tron:[1-9][0-9]{0,9}$/.test(chain) && Number(chain.slice(5)) <= 0xffffffff;
}

/** `tron:728126428` → `0x2b6653dc` (TIP-1193). */
export function tronChainId(chain: string): string {
  return `0x${Number(chain.slice(5)).toString(16).padStart(8, '0')}`;
}

/** `0x2b6653dc` → `tron:728126428`, or null. */
export function tronChainOf(chainId: string): string | null {
  if (!/^0x[0-9a-fA-F]{1,8}$/.test(chainId)) return null;
  const chain = `tron:${parseInt(chainId, 16)}`;
  return isTronChain(chain) ? chain : null;
}

/** The 21-byte address of a base58check account, or null. */
export function tronAddressBytes(account: string): Uint8Array | null {
  if (account.length !== 34) return null;
  const bytes = base58Decode(account);
  if (!bytes || bytes.length !== 25 || bytes[0] !== 0x41) return null;
  const address = bytes.subarray(0, 21);
  const checksum = sha256(sha256(address)).subarray(0, 4);
  return checksum.every((b, i) => b === bytes[21 + i]) ? address : null;
}

export const isTronAccount = (account: string): boolean => tronAddressBytes(account) !== null;

/** The base58check form of a 21-byte address. */
export function tronAccount(address: Uint8Array): string {
  const checksum = sha256(sha256(address)).subarray(0, 4);
  const bytes = new Uint8Array(25);
  bytes.set(address);
  bytes.set(checksum, 21);
  return base58Encode(bytes);
}

/** `T…` → `41…` */
export function tronHexAddress(account: string): string | null {
  const bytes = tronAddressBytes(account);
  return bytes ? bytesToHex(bytes) : null;
}

const MAX_MESSAGE_BYTES = 65_536;
const invalid = (message = 'Invalid params'): RpcError => rpcError(ErrorCode.InvalidParams, message);

function checkAccount(input: Record<string, unknown>, state: NamespaceState): RpcError | null {
  if (typeof input.account !== 'string' || !isTronAccount(input.account)) return invalid('Invalid account');
  if (input.chain !== undefined && (typeof input.chain !== 'string' || !isTronChain(input.chain))) {
    return invalid('Invalid chain');
  }
  if (!state.accounts.includes(input.account)) return rpcError(ErrorCode.Unauthorized, 'Account is not approved');
  if (input.chain !== undefined && input.chain !== state.chain) {
    return rpcError(ErrorCode.ChainMismatch, 'Chain is not active');
  }
  return null;
}

/** Lowercase or uppercase hex without 0x, of 1 to `max` bytes. */
function hexBytes(value: unknown, max: number): Uint8Array | null {
  if (typeof value !== 'string') return null;
  const bytes = hexToBytes(value);
  return bytes && bytes.length >= 1 && bytes.length <= max ? bytes : null;
}

const functions: Record<string, WalletFunction> = {
  tron_signTransaction: {
    check(params: Params | undefined, state) {
      if (!isObject(params)) return invalid();
      const refused = checkAccount(params, state);
      if (refused) return refused;
      const raw = hexBytes(params.transaction, 65_536);
      if (!raw) return invalid('transaction must be raw_data_hex');
      if (!parseTronRaw(raw)) return invalid('Not a TRON transaction with one contract');
      return null;
    },
  },

  tron_signMessage: {
    check(params, state) {
      if (!isObject(params)) return invalid();
      // A chain member means nothing here and is ignored.
      const refused = checkAccount({ account: params.account }, state);
      if (refused) return refused;
      return hexBytes(params.message, MAX_MESSAGE_BYTES) ? null : invalid('message must be hex bytes');
    },
  },

  tron_switchChain: {
    check(params) {
      return isObject(params) && typeof params.chain === 'string' && isTronChain(params.chain) ? null : invalid();
    },
  },
};

export const tron: Network = {
  namespace: 'tron',
  isChain: isTronChain,
  isAccount: isTronAccount,
  functions,
};
