/**
 * WalletPair Protocol v1 — Appendix A cryptographic test vectors.
 *
 * Verifies that the SDK's crypto primitives produce byte-for-byte identical
 * outputs for all known-input vectors in the specification. Any independent
 * implementation can run these tests to confirm interoperability.
 */

import { describe, expect, it } from 'vitest';
import {
  b64urlDecode,
  b64urlEncode,
  bytesToHex,
  canonicalJson,
  computeHandshakeTranscriptHash,
  computeSessionFingerprint,
  computeSharedSecret,
  deriveDirectionalSessionKeys,
  deriveJoinEncryptionKey,
  deriveSessionKey,
  getPublicKey,
  hexToBytes,
  sealPayload,
  sha256Hex,
  unsealJoin,
  unsealPayload,
} from '../../crypto.js';
import type { SessionCryptoContext } from '../../crypto.js';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils';

// ---------------------------------------------------------------------------
// Appendix A values (all from the protocol spec)
// ---------------------------------------------------------------------------

const DAPP_PRIVATE_KEY = 'a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4';
const DAPP_PUBLIC_KEY = '1c9fd88f45606d932a80c71824ae151d15d73e77de38e8e000852e614fae7019';
const DAPP_PUB_B64 = 'HJ_Yj0VgbZMqgMcYJK4VHRXXPnfeOOjgAIUuYU-ucBk';

const WALLET_PRIVATE_KEY = '4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d';
const WALLET_PUBLIC_KEY = 'ff63fe57bfbf43fa3f563628b149af704d3db625369c49983650347a6a71e00e';
const WALLET_PUB_B64 = '_2P-V7-_Q_o_VjYosUmvcE09tiU2nEmYNlA0empx4A4';

const CHANNEL_ID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
const SHARED_SECRET = '739311d35d8d3c41da4062c799a6c748808a31343facaaa7aa7e311908c1846e';

// A.2
const ROOT_KEY = 'c33b664ab3eea368d81109b432f04a1293a743212749e19bfe412a2996dcefee';
const JOIN_ENCRYPTION_KEY = '981e75c4fad86e3db377517816a24b27564661ab89d327217684e0a56d68ec11';

// A.4
const TRANSCRIPT_HASH = 'dd2cf890c3ac3855c1fb2479ada829d7dd3656001f80e316fa5e16fed5d6b535';
const DAPP_TO_WALLET_KEY = '1353e42d494f8618e6bfc04c0236cc6004994c52c95d371f113459ea153c7fdc';
const WALLET_TO_DAPP_KEY = 'fd0240cd5d4b00b3709549e102a918cf08d0d268fbdf468477cdc1ef663a55d6';

// A.5
const FINGERPRINT_SHA256 = '7f301a56626650b08f11c99df3333237a66fae34e0c0d1512c19fe51d41a8604';
const FINGERPRINT = '8902';

// A.6
const TRAFFIC_KEY_A6 = '1353e42d494f8618e6bfc04c0236cc6004994c52c95d371f113459ea153c7fdc';
const NONCE_A6 = 'b71ba8a87d41562e5af426d7';
const AAD_HEADER_A6 = '01002b484a5f596a305667625a4d71674d63594a4b345648525858506e66654f4f6a674149557559552d7563426b00077265712d303031';
const PLAINTEXT_A6 = '{"_method":"wallet_getAccounts","chain":"eip155:1"}';
const CIPHERTEXT_TAG_A6 =
  '2aed1e76963c25234d9a2e023fdf40d35b9e1c7a9a3fd121' +
  'c045c14df5e5627726213febe2459ff4c24d2c709d4c19d0' +
  '0b6f43f8ea2418e68e8e0840bf7771ada851a5';
const SEALED_A6 = 'AAAAACrtHnaWPCUjTZouAj_fQNNbnhx6mj_RIcBFwU315WJ3JiE_6-JFn_TCTSxwnUwZ0AtvQ_jqJBjmjo4IQL93ca2oUaU';

// A.3
const JOIN_NONCE = '09474eabe263432ebc7e4756';
const JOIN_AAD = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b204';
const SEALED_JOIN_B64 = 'CUdOq-JjQy68fkdWHyGJa2GLNBPXEb-0vK1HlTCmQrZwEdqRRb0iyBX9ZHGkv74L6J24LMM2AVFsrXV9pjcCmtLx21fkj6ves8rd-RtjyW6WS44-qo87sn36IpLjhItuUjq_elDUr_qCOpwhoVIrFC29b7n_9q8UdbMAd5HwdKNiKFLrb91_rWhVj3H_y78fyft8LiHb52p0yF2RWB5m0-vZh0A9Rk9HBL9amsEPnOQiylZvCu-1gEko2SyCpkUGl0eXGOLs6vvnSCFiZjy8HLg95kjZoGaBqONQrF-dKoo-rT9hlW9fkMEi7rpDRzKWsTHIkYfnyTYNDk6M3o9mg_7z2k6FGwJqAXD2qCqjDXECVgytsvl_y68vSQqML2H74oFK_dx4SzHsoZWebv9fBve4kJHE5NEzCx3f';

const JOIN_PLAINTEXT = '{"capabilities":{"chains":["eip155:1","eip155:137"],"events":["accountsChanged","chainChanged"],"methods":["wallet_signTransaction","wallet_signMessage"]},"meta":{"description":"A multi-chain wallet","icon":"https://mywallet.app/icon.png","name":"MyWallet","url":"https://mywallet.app"}}';

// ---------------------------------------------------------------------------
// A.1 Key Material
// ---------------------------------------------------------------------------

describe('Appendix A.1 — Key Material', () => {
  it('derives the correct public key from the dApp private key', () => {
    const pub = getPublicKey(hexToBytes(DAPP_PRIVATE_KEY));
    expect(bytesToHex(pub)).toBe(DAPP_PUBLIC_KEY);
  });

  it('derives the correct public key from the wallet private key', () => {
    const pub = getPublicKey(hexToBytes(WALLET_PRIVATE_KEY));
    expect(bytesToHex(pub)).toBe(WALLET_PUBLIC_KEY);
  });

  it('base64url-encodes the dApp public key correctly', () => {
    expect(b64urlEncode(hexToBytes(DAPP_PUBLIC_KEY))).toBe(DAPP_PUB_B64);
  });

  it('base64url-encodes the wallet public key correctly', () => {
    expect(b64urlEncode(hexToBytes(WALLET_PUBLIC_KEY))).toBe(WALLET_PUB_B64);
  });

  it('computes the correct X25519 shared secret (dApp perspective)', () => {
    const shared = computeSharedSecret(
      hexToBytes(DAPP_PRIVATE_KEY),
      hexToBytes(WALLET_PUBLIC_KEY),
    );
    expect(bytesToHex(shared)).toBe(SHARED_SECRET);
  });

  it('computes the correct X25519 shared secret (wallet perspective)', () => {
    const shared = computeSharedSecret(
      hexToBytes(WALLET_PRIVATE_KEY),
      hexToBytes(DAPP_PUBLIC_KEY),
    );
    expect(bytesToHex(shared)).toBe(SHARED_SECRET);
  });
});

// ---------------------------------------------------------------------------
// A.2 Key Derivation
// ---------------------------------------------------------------------------

describe('Appendix A.2 — Key Derivation', () => {
  it('derives the correct root_key', () => {
    const rootKey = deriveSessionKey(hexToBytes(SHARED_SECRET), CHANNEL_ID);
    expect(bytesToHex(rootKey)).toBe(ROOT_KEY);
  });

  it('derives the correct join_encryption_key', () => {
    const joinKey = deriveJoinEncryptionKey(hexToBytes(ROOT_KEY), CHANNEL_ID);
    expect(bytesToHex(joinKey)).toBe(JOIN_ENCRYPTION_KEY);
  });
});

// ---------------------------------------------------------------------------
// A.3 Sealed Join
// ---------------------------------------------------------------------------

describe('Appendix A.3 — Sealed Join', () => {
  it('canonical JSON of join plaintext matches the spec', () => {
    const joinObj = {
      capabilities: {
        methods: ['wallet_signTransaction', 'wallet_signMessage'],
        events: ['accountsChanged', 'chainChanged'],
        chains: ['eip155:1', 'eip155:137'],
      },
      meta: {
        name: 'MyWallet',
        description: 'A multi-chain wallet',
        url: 'https://mywallet.app',
        icon: 'https://mywallet.app/icon.png',
      },
    };
    expect(canonicalJson(joinObj)).toBe(JOIN_PLAINTEXT);
  });

  it('join_aad is channel_id_bytes || 0x04', () => {
    const expected = hexToBytes(JOIN_AAD);
    const chBytes = hexToBytes(CHANNEL_ID);
    const aad = new Uint8Array(chBytes.length + 1);
    aad.set(chBytes);
    aad[chBytes.length] = 0x04;
    expect(bytesToHex(aad)).toBe(bytesToHex(expected));
  });

  it('decrypts the sealed_join test vector correctly', () => {
    const joinKey = hexToBytes(JOIN_ENCRYPTION_KEY);
    const result = unsealJoin(joinKey, CHANNEL_ID, SEALED_JOIN_B64);
    expect(result.capabilities).toEqual({
      chains: ['eip155:1', 'eip155:137'],
      events: ['accountsChanged', 'chainChanged'],
      methods: ['wallet_signTransaction', 'wallet_signMessage'],
    });
    expect(result.meta).toEqual({
      description: 'A multi-chain wallet',
      icon: 'https://mywallet.app/icon.png',
      name: 'MyWallet',
      url: 'https://mywallet.app',
    });
  });

  it('sealed_join envelope starts with the specified nonce', () => {
    const envelope = b64urlDecode(SEALED_JOIN_B64);
    const nonce = envelope.slice(0, 12);
    expect(bytesToHex(nonce)).toBe(JOIN_NONCE);
  });
});

// ---------------------------------------------------------------------------
// A.4 Transcript and Traffic Keys
// ---------------------------------------------------------------------------

describe('Appendix A.4 — Transcript Hash and Traffic Keys', () => {
  const context: SessionCryptoContext = {
    dappPubKeyB64: DAPP_PUB_B64,
    walletPubKeyB64: WALLET_PUB_B64,
    capabilities: {
      chains: ['eip155:1', 'eip155:137'],
      events: ['accountsChanged', 'chainChanged'],
      methods: ['wallet_signTransaction', 'wallet_signMessage'],
    },
    walletMeta: {
      description: 'A multi-chain wallet',
      icon: 'https://mywallet.app/icon.png',
      name: 'MyWallet',
      url: 'https://mywallet.app',
    },
    dappName: 'MyDApp',
  };

  it('computes the correct transcript_hash', () => {
    const hash = computeHandshakeTranscriptHash(CHANNEL_ID, context);
    expect(bytesToHex(hash)).toBe(TRANSCRIPT_HASH);
  });

  it('derives the correct dapp_to_wallet_key', () => {
    const rootKey = hexToBytes(ROOT_KEY);
    const keys = deriveDirectionalSessionKeys(rootKey, CHANNEL_ID, context);
    expect(bytesToHex(keys.dappToWalletKey)).toBe(DAPP_TO_WALLET_KEY);
  });

  it('derives the correct wallet_to_dapp_key', () => {
    const rootKey = hexToBytes(ROOT_KEY);
    const keys = deriveDirectionalSessionKeys(rootKey, CHANNEL_ID, context);
    expect(bytesToHex(keys.walletToDappKey)).toBe(WALLET_TO_DAPP_KEY);
  });

  it('transcript_hash in directional keys matches standalone computation', () => {
    const rootKey = hexToBytes(ROOT_KEY);
    const keys = deriveDirectionalSessionKeys(rootKey, CHANNEL_ID, context);
    expect(bytesToHex(keys.transcriptHash)).toBe(TRANSCRIPT_HASH);
  });
});

// ---------------------------------------------------------------------------
// A.5 Session Fingerprint
// ---------------------------------------------------------------------------

describe('Appendix A.5 — Session Fingerprint', () => {
  it('computes the correct SHA-256 prefix', () => {
    // Verify the full SHA-256 matches
    const hash = sha256(concatBytes(
      utf8ToBytes('walletpair-v1-session-fingerprint'),
      hexToBytes(CHANNEL_ID),
      hexToBytes(DAPP_PUBLIC_KEY),
    ));
    expect(bytesToHex(hash)).toBe(FINGERPRINT_SHA256);
  });

  it('computes the correct 4-digit fingerprint', () => {
    const fp = computeSessionFingerprint(CHANNEL_ID, DAPP_PUB_B64);
    expect(fp).toBe(FINGERPRINT);
  });

  it('fp_uint32 mod 10000 produces the correct value', () => {
    // fp_bytes = 7f301a56, fp_uint32 = 2133858902
    const fpBytes = hexToBytes('7f301a56');
    const view = new DataView(fpBytes.buffer, fpBytes.byteOffset, 4);
    const fpUint32 = view.getUint32(0);
    expect(fpUint32).toBe(2133858902);
    expect(fpUint32 % 10000).toBe(8902);
  });
});

// ---------------------------------------------------------------------------
// A.6 AEAD Encryption (dapp->wallet, seq=0)
// ---------------------------------------------------------------------------

describe('Appendix A.6 — AEAD Encryption (dapp->wallet, seq=0)', () => {
  it('nonce = HMAC-SHA256(traffic_key, seq_bytes)[0:12] matches the spec', () => {
    const key = hexToBytes(TRAFFIC_KEY_A6);
    const seqBytes = new Uint8Array(4); // seq=0
    const nonce = hmac(sha256, key, seqBytes).slice(0, 12);
    expect(bytesToHex(nonce)).toBe(NONCE_A6);
  });

  it('AAD header matches the spec', () => {
    // Rebuild AAD header: 0x01 || lp(from) || lp(id)
    const fromStr = 'HJ_Yj0VgbZMqgMcYJK4VHRXXPnfeOOjgAIUuYU-ucBk';
    const idStr = 'req-001';

    function lp(s: string): Uint8Array {
      const bytes = utf8ToBytes(s);
      const len = new Uint8Array(2);
      new DataView(len.buffer).setUint16(0, bytes.length);
      return concatBytes(len, bytes);
    }

    const header = concatBytes(
      new Uint8Array([0x01]),
      lp(fromStr),
      lp(idStr),
    );
    expect(bytesToHex(header)).toBe(AAD_HEADER_A6);
  });

  it('sealPayload produces the expected sealed output for seq=0', () => {
    const key = hexToBytes(TRAFFIC_KEY_A6);
    const data = { _method: 'wallet_getAccounts', chain: 'eip155:1' };
    const header = { type: 'req' as const, from: DAPP_PUB_B64, id: 'req-001' };
    const sealed = sealPayload(key, CHANNEL_ID, 0, data, header);
    expect(sealed).toBe(SEALED_A6);
  });

  it('unsealPayload decrypts the expected sealed output for seq=0', () => {
    const key = hexToBytes(TRAFFIC_KEY_A6);
    const header = { type: 'req' as const, from: DAPP_PUB_B64, id: 'req-001' };
    const { seq, data, plaintextJson } = unsealPayload(key, CHANNEL_ID, SEALED_A6, header);
    expect(seq).toBe(0);
    expect(plaintextJson).toBe(PLAINTEXT_A6);
    expect(data).toEqual({ _method: 'wallet_getAccounts', chain: 'eip155:1' });
  });

  it('ciphertext+tag in the sealed envelope matches the spec', () => {
    const envelope = b64urlDecode(SEALED_A6);
    const seqBytes = envelope.slice(0, 4);
    const ciphertextTag = envelope.slice(4);
    expect(bytesToHex(seqBytes)).toBe('00000000');
    expect(bytesToHex(ciphertextTag)).toBe(CIPHERTEXT_TAG_A6);
  });
});
