// Solana's serialized transaction format, legacy and version 0: just enough
// to check a transaction and find a signer's slot (spec/networks/solana.md §2.1).

export const MAX_TRANSACTION_BYTES = 1232;

export interface SolanaTransaction {
  version: 'legacy' | 0;
  /** Offset of the first signature (after the compact-u16 count). */
  signaturesOffset: number;
  /** Offset of the message, which is what signers sign. */
  messageOffset: number;
  numRequiredSignatures: number;
  /** The signers' public keys, in signature order. */
  signers: Uint8Array[];
}

class Reader {
  offset: number;
  constructor(
    readonly bytes: Uint8Array,
    offset = 0,
  ) {
    this.offset = offset;
  }

  u8(): number {
    if (this.offset >= this.bytes.length) throw new RangeError('truncated');
    return this.bytes[this.offset++];
  }

  /** Solana's compact-u16: 1 to 3 bytes, 7 bits each, little-endian. */
  compactU16(): number {
    let value = 0;
    for (let i = 0; i < 3; i++) {
      const byte = this.u8();
      value |= (byte & 0x7f) << (7 * i);
      if ((byte & 0x80) === 0) {
        if (i > 0 && byte === 0) throw new RangeError('non-canonical compact-u16');
        if (value > 0xffff) throw new RangeError('compact-u16 overflow');
        return value;
      }
    }
    throw new RangeError('compact-u16 too long');
  }

  skip(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) throw new RangeError('truncated');
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }
}

interface MessageInfo {
  version: 'legacy' | 0;
  numRequiredSignatures: number;
  signers: Uint8Array[];
}

/** Parses a message that must end exactly at the end of `bytes`. */
function readMessage(reader: Reader): MessageInfo {
  let version: 'legacy' | 0 = 'legacy';
  const first = reader.bytes[reader.offset];
  if (first !== undefined && first & 0x80) {
    if (first !== 0x80) throw new RangeError('unsupported transaction version');
    version = 0;
    reader.u8();
  }
  const numRequiredSignatures = reader.u8();
  const numReadonlySigned = reader.u8();
  reader.u8(); // numReadonlyUnsigned
  if (numRequiredSignatures === 0 || numReadonlySigned >= numRequiredSignatures) throw new RangeError('bad header');

  const keyCount = reader.compactU16();
  if (keyCount < numRequiredSignatures) throw new RangeError('too few keys');
  const keys: Uint8Array[] = [];
  for (let i = 0; i < keyCount; i++) keys.push(reader.skip(32));
  reader.skip(32); // recent blockhash or nonce

  const instructions = reader.compactU16();
  for (let i = 0; i < instructions; i++) {
    reader.u8(); // program id index
    reader.skip(reader.compactU16()); // account indexes
    reader.skip(reader.compactU16()); // data
  }
  if (version === 0) {
    const lookups = reader.compactU16();
    for (let i = 0; i < lookups; i++) {
      reader.skip(32);
      reader.skip(reader.compactU16()); // writable indexes
      reader.skip(reader.compactU16()); // readonly indexes
    }
  }
  if (reader.offset !== reader.bytes.length) throw new RangeError('trailing bytes');
  return { version, numRequiredSignatures, signers: keys.slice(0, numRequiredSignatures) };
}

/** Parses a serialized legacy or v0 transaction, or returns null. */
export function parseTransaction(bytes: Uint8Array): SolanaTransaction | null {
  if (bytes.length > MAX_TRANSACTION_BYTES) return null;
  try {
    const reader = new Reader(bytes);
    const count = reader.compactU16();
    const signaturesOffset = reader.offset;
    reader.skip(count * 64);
    const messageOffset = reader.offset;
    const message = readMessage(reader);
    if (count !== message.numRequiredSignatures) return null;
    return { signaturesOffset, messageOffset, ...message };
  } catch {
    return null;
  }
}

/** Whether the bytes are a legacy or v0 transaction message on their own. */
export function isTransactionMessage(bytes: Uint8Array): boolean {
  try {
    readMessage(new Reader(bytes));
    return true;
  } catch {
    return false;
  }
}

/** The index of `publicKey` among the transaction's signers, or -1. */
export function signerIndex(tx: SolanaTransaction, publicKey: Uint8Array): number {
  return tx.signers.findIndex((key) => key.length === publicKey.length && key.every((b, i) => b === publicKey[i]));
}
