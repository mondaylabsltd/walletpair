// The reference Wallet's Solana signer, written from spec/networks/solana.md §2
// with @noble/curves; tests check its output with @solana/web3.js.

import { ed25519 } from '@noble/curves/ed25519.js';
import { base58Encode, base64Decode, base64Encode, hexToBytes } from '../../src/lib/walletpair/codec';
import { solana } from '../../src/lib/walletpair/networks/solana';
import { parseTransaction, signerIndex } from '../../src/lib/walletpair/networks/solana-transaction';
import { WalletError, type Signer } from './wallet';

export const SOLANA_TEST_SEED = '0101010101010101010101010101010101010101010101010101010101010101';

/** Signs the transaction's message and writes the signature into the account's slot only (§2.1). */
export function signSolanaTransaction(bytes: Uint8Array, seed: Uint8Array): Uint8Array {
  const tx = parseTransaction(bytes);
  if (!tx) throw new WalletError(-32602, 'Not a legacy or version 0 transaction');
  const index = signerIndex(tx, ed25519.getPublicKey(seed));
  if (index < 0) throw new WalletError(-32602, 'Account is not a signer');
  const signed = bytes.slice();
  signed.set(ed25519.sign(bytes.subarray(tx.messageOffset), seed), tx.signaturesOffset + 64 * index);
  return signed;
}

export function solanaSigner(
  seedHex = SOLANA_TEST_SEED,
  chain = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
): Signer & { sent: Uint8Array[] } {
  const seed = hexToBytes(seedHex)!;
  const sent: Uint8Array[] = [];
  return {
    network: solana,
    chain,
    accounts: [base58Encode(ed25519.getPublicKey(seed))],
    sent,
    async perform(method, params) {
      const p = params as Record<string, any>;
      switch (method) {
        case 'solana_signTransactions':
          return {
            transactions: (p.transactions as string[]).map((tx) => base64Encode(signSolanaTransaction(base64Decode(tx)!, seed))),
          };
        case 'solana_signAndSendTransaction': {
          const signed = signSolanaTransaction(base64Decode(p.transaction)!, seed);
          const tx = parseTransaction(signed)!;
          sent.push(signed);
          return { signature: base64Encode(signed.subarray(tx.signaturesOffset, tx.signaturesOffset + 64)) };
        }
        case 'solana_signMessage':
          return { signature: base64Encode(ed25519.sign(base64Decode(p.message)!, seed)) };
      }
      throw new WalletError(4200, `Unsupported: ${method}`);
    },
  };
}
