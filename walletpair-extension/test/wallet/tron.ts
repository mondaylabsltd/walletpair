// The reference Wallet's TRON signer, written from spec/networks/tron.md §2
// with @noble primitives; spec/test-vectors/tron.json checks it against TronWeb.

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '../../src/lib/walletpair/codec';
import { TRON_NETWORKS, tron, tronAccount } from '../../src/lib/walletpair/networks/tron';
import { parseTronRaw } from '../../src/lib/walletpair/networks/tron-transaction';
import { WalletError, type Signer } from './wallet';

export const TRON_TEST_KEY = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

export function tronAddressOf(privateKey: Uint8Array): string {
  const publicKey = secp256k1.getPublicKey(privateKey, false).subarray(1);
  const address = new Uint8Array(21);
  address[0] = 0x41;
  address.set(keccak_256(publicKey).subarray(12), 1);
  return tronAccount(address);
}

/** 65 bytes r ‖ s ‖ v, v = 27 + recovery, as hex. */
export function tronSign(digest: Uint8Array, privateKey: Uint8Array): string {
  const recovered = secp256k1.sign(digest, privateKey, { prehash: false, format: 'recovered' });
  const signature = new Uint8Array(65);
  signature.set(recovered.subarray(1), 0);
  signature[64] = 27 + recovered[0];
  return bytesToHex(signature);
}

/** The V2 message digest (§2.2). */
export function tronMessageDigest(message: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(`\x19TRON Signed Message:\n${message.length}`);
  const data = new Uint8Array(prefix.length + message.length);
  data.set(prefix);
  data.set(message, prefix.length);
  return keccak_256(data);
}

export function tronSigner(privateKeyHex = TRON_TEST_KEY, chain = 'tron:3448148188', now = () => Date.now()): Signer {
  const privateKey = hexToBytes(privateKeyHex)!;
  return {
    network: tron,
    chain,
    accounts: [tronAddressOf(privateKey)],
    async perform(method, params, context) {
      const p = params as Record<string, string>;
      switch (method) {
        case 'tron_signTransaction': {
          const raw = hexToBytes(p.transaction)!;
          const tx = parseTronRaw(raw);
          if (!tx) throw new WalletError(-32602, 'Not a TRON transaction');
          const expiration = tx.expiration === undefined ? undefined : Number(tx.expiration);
          if (expiration !== undefined && (expiration <= now() || expiration > now() + 86_400_000)) {
            throw new WalletError(-32602, 'Transaction expired or expires too late');
          }
          return { signature: tronSign(sha256(raw), privateKey) };
        }
        case 'tron_signMessage':
          return { signature: tronSign(tronMessageDigest(hexToBytes(p.message)!), privateKey) };
        case 'tron_switchChain':
          if (!TRON_NETWORKS.some((n) => n.chain === p.chain)) throw new WalletError(4902, 'Unknown chain');
          context.setChain(p.chain);
          return null;
      }
      throw new WalletError(4200, `Unsupported: ${method}`);
    },
  };
}
