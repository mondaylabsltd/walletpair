import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  concatBytes,
  hexToBytes,
  isAllZero,
  lp,
  readUint32be,
  uint32be,
  utf8,
} from './encoding';
import { decodeJsonMessagePack, encodeJsonMessagePack, type JsonValue } from './msgpack';
import { type ParticipantMeta, validateChannelId, validateParticipantMeta, validatePublicKey } from './relay';

const ROOT_INFO = utf8('walletpair-v1/root');
const TRANSCRIPT_DOMAIN = utf8('walletpair-v1/transcript');
const DAPP_TO_WALLET_INFO = utf8('walletpair-v1/dapp-to-wallet');
const WALLET_TO_DAPP_INFO = utf8('walletpair-v1/wallet-to-dapp');
const FINGERPRINT_DOMAIN = utf8('walletpair-v1-dapp-fingerprint');
const AEAD_DOMAIN = utf8('walletpair-v1/aead');
const MAX_SEQUENCE = 2 ** 31;
const MAX_SEALED_BYTES = 4 + 64 * 1024 + 16;

export type PeerRole = 'dapp' | 'wallet';

export interface KeyPair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
  publicKeyBase64Url: string;
}

export interface TrafficKeys {
  transcriptHash: Uint8Array;
  dappToWalletKey: Uint8Array;
  walletToDappKey: Uint8Array;
}

export interface CipherCounters {
  sendSequence: number;
  receiveSequence: number;
}

export interface OpenedFrame {
  value: JsonValue;
  caip2: string;
  sequence: number;
}

export type PersistCounters = (counters: CipherCounters) => Promise<void>;

export class CounterPersistenceError extends Error {
  constructor(cause: unknown) {
    super('failed to persist channel sequence state', { cause });
    this.name = 'CounterPersistenceError';
  }
}

export function generateX25519KeyPair(): KeyPair {
  const pair = x25519.keygen();
  return {
    secretKey: pair.secretKey.slice(),
    publicKey: pair.publicKey.slice(),
    publicKeyBase64Url: bytesToBase64Url(pair.publicKey),
  };
}

export function deriveTrafficKeys(
  channelId: string,
  localSecretKey: Uint8Array,
  dappPublicKeyBase64Url: string,
  walletPublicKeyBase64Url: string,
): TrafficKeys {
  validateChannelId(channelId);
  if (localSecretKey.length !== 32) throw new TypeError('X25519 private key must be 32 bytes');
  const dappPublicKey = validatePublicKey(dappPublicKeyBase64Url);
  const walletPublicKey = validatePublicKey(walletPublicKeyBase64Url);
  const localPublicKey = x25519.getPublicKey(localSecretKey);
  const remotePublicKey = equalBytes(localPublicKey, dappPublicKey) ? walletPublicKey : dappPublicKey;
  if (!equalBytes(localPublicKey, dappPublicKey) && !equalBytes(localPublicKey, walletPublicKey)) {
    throw new TypeError('local X25519 key is not part of the transcript');
  }

  const channelBytes = hexToBytes(channelId, 32);
  let sharedSecret: Uint8Array | undefined;
  let rootKey: Uint8Array | undefined;
  try {
    sharedSecret = x25519.getSharedSecret(localSecretKey, remotePublicKey);
    if (isAllZero(sharedSecret)) throw new TypeError('invalid all-zero X25519 shared secret');
    rootKey = hkdf(sha256, sharedSecret, channelBytes, ROOT_INFO, 32);
    const transcriptHash = sha256(concatBytes(
      TRANSCRIPT_DOMAIN,
      channelBytes,
      lp(dappPublicKeyBase64Url),
      lp(walletPublicKeyBase64Url),
    ));
    return {
      transcriptHash,
      dappToWalletKey: hkdf(sha256, rootKey, transcriptHash, DAPP_TO_WALLET_INFO, 32),
      walletToDappKey: hkdf(sha256, rootKey, transcriptHash, WALLET_TO_DAPP_INFO, 32),
    };
  } finally {
    sharedSecret?.fill(0);
    rootKey?.fill(0);
  }
}

export function computeDappPairingCode(
  channelId: string,
  meta: ParticipantMeta,
  dappPublicKeyBase64Url: string,
): string {
  validateChannelId(channelId);
  validateParticipantMeta(meta);
  validatePublicKey(dappPublicKeyBase64Url);
  const digest = sha256(concatBytes(
    FINGERPRINT_DOMAIN,
    hexToBytes(channelId, 32),
    lp(meta.name),
    lp(meta.url),
    lp(meta.icon),
    lp(dappPublicKeyBase64Url),
  ));
  const number = new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0, false) % 10_000;
  return number.toString().padStart(4, '0');
}

export function validateCaip2(value: string): void {
  if (utf8(value).length > 41 || !/^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/.test(value)) {
    throw new TypeError('invalid canonical CAIP-2 chain ID');
  }
  if (value.startsWith('eip155:') && !/^eip155:[1-9][0-9]*$/.test(value)) {
    throw new TypeError('invalid canonical EIP-155 CAIP-2 chain ID');
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

function nonce(sequenceBytes: Uint8Array): Uint8Array {
  return concatBytes(new Uint8Array(8), sequenceBytes);
}

function aad(
  channelBytes: Uint8Array,
  transcriptHash: Uint8Array,
  direction: number,
  sequenceBytes: Uint8Array,
  caip2: string,
): Uint8Array {
  return concatBytes(
    AEAD_DOMAIN,
    channelBytes,
    transcriptHash,
    Uint8Array.of(direction),
    sequenceBytes,
    lp(caip2),
  );
}

export class ChannelCipher {
  private readonly channelBytes: Uint8Array;
  private readonly transcriptHash: Uint8Array;
  private readonly sendKey: Uint8Array;
  private readonly receiveKey: Uint8Array;
  private readonly sendDirection: number;
  private readonly receiveDirection: number;
  private sendSequence: number;
  private receiveSequence: number;
  private destroyed = false;

  constructor(
    channelId: string,
    role: PeerRole,
    trafficKeys: TrafficKeys,
    counters: CipherCounters = { sendSequence: 0, receiveSequence: -1 },
  ) {
    validateChannelId(channelId);
    validateCounters(counters);
    this.channelBytes = hexToBytes(channelId, 32);
    this.transcriptHash = trafficKeys.transcriptHash.slice();
    this.sendKey = (role === 'dapp' ? trafficKeys.dappToWalletKey : trafficKeys.walletToDappKey).slice();
    this.receiveKey = (role === 'dapp' ? trafficKeys.walletToDappKey : trafficKeys.dappToWalletKey).slice();
    this.sendDirection = role === 'dapp' ? 0x01 : 0x02;
    this.receiveDirection = role === 'dapp' ? 0x02 : 0x01;
    this.sendSequence = counters.sendSequence;
    this.receiveSequence = counters.receiveSequence;
  }

  counters(): CipherCounters {
    return { sendSequence: this.sendSequence, receiveSequence: this.receiveSequence };
  }

  async seal(value: unknown, caip2: string, persist: PersistCounters): Promise<string> {
    this.assertUsable();
    validateCaip2(caip2);
    const plaintext = encodeJsonMessagePack(value);
    if (this.sendSequence >= MAX_SEQUENCE) throw new RangeError('channel send sequence is exhausted');
    const sequence = this.sendSequence;
    const sequenceBytes = uint32be(sequence);

    // Persist the reservation before any ciphertext under this nonce exists.
    this.sendSequence += 1;
    try {
      await persist(this.counters());
    } catch (error) {
      throw error instanceof CounterPersistenceError ? error : new CounterPersistenceError(error);
    }

    const ciphertextTag = chacha20poly1305(
      this.sendKey,
      nonce(sequenceBytes),
      aad(this.channelBytes, this.transcriptHash, this.sendDirection, sequenceBytes, caip2),
    ).encrypt(plaintext);
    return `${bytesToBase64Url(concatBytes(sequenceBytes, ciphertextTag))}@${caip2}`;
  }

  async open(frame: string, persist: PersistCounters): Promise<OpenedFrame> {
    this.assertUsable();
    const separator = frame.indexOf('@');
    if (separator <= 0 || separator !== frame.lastIndexOf('@') || separator === frame.length - 1) {
      throw new TypeError('encrypted frame must contain exactly one separator');
    }
    const sealedText = frame.slice(0, separator);
    const caip2 = frame.slice(separator + 1);
    validateCaip2(caip2);
    const sealed = base64UrlToBytes(sealedText);
    if (sealed.length < 20 || sealed.length > MAX_SEALED_BYTES) {
      throw new RangeError('encrypted frame has an invalid size');
    }
    const sequenceBytes = sealed.subarray(0, 4);
    const sequence = readUint32be(sequenceBytes);
    if (sequence >= MAX_SEQUENCE || sequence <= this.receiveSequence) {
      throw new RangeError('replayed or out-of-order encrypted frame');
    }
    const plaintext = chacha20poly1305(
      this.receiveKey,
      nonce(sequenceBytes),
      aad(this.channelBytes, this.transcriptHash, this.receiveDirection, sequenceBytes, caip2),
    ).decrypt(sealed.subarray(4));
    const value = decodeJsonMessagePack(plaintext);

    // Do not deliver a valid plaintext until its replay state is durable.
    this.receiveSequence = sequence;
    try {
      await persist(this.counters());
    } catch (error) {
      throw error instanceof CounterPersistenceError ? error : new CounterPersistenceError(error);
    }
    return { value, caip2, sequence };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sendKey.fill(0);
    this.receiveKey.fill(0);
    this.transcriptHash.fill(0);
  }

  private assertUsable(): void {
    if (this.destroyed) throw new Error('channel cipher is closed');
  }
}

export function createChannelCipher(
  channelId: string,
  role: PeerRole,
  localSecretKey: Uint8Array,
  dappPublicKeyBase64Url: string,
  walletPublicKeyBase64Url: string,
  counters?: CipherCounters,
): ChannelCipher {
  const trafficKeys = deriveTrafficKeys(
    channelId,
    localSecretKey,
    dappPublicKeyBase64Url,
    walletPublicKeyBase64Url,
  );
  try {
    return new ChannelCipher(channelId, role, trafficKeys, counters);
  } finally {
    trafficKeys.dappToWalletKey.fill(0);
    trafficKeys.walletToDappKey.fill(0);
    trafficKeys.transcriptHash.fill(0);
  }
}

export function decodeStoredSecretKey(value: string): Uint8Array {
  return base64UrlToBytes(value, 32);
}

function validateCounters(counters: CipherCounters): void {
  if (!Number.isInteger(counters.sendSequence) || counters.sendSequence < 0 || counters.sendSequence > MAX_SEQUENCE) {
    throw new TypeError('invalid persisted send sequence');
  }
  if (!Number.isInteger(counters.receiveSequence) || counters.receiveSequence < -1 || counters.receiveSequence >= MAX_SEQUENCE) {
    throw new TypeError('invalid persisted receive sequence');
  }
}
