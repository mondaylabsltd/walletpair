import { concatBytes, utf8, utf8String } from './encoding';

export const MAX_PLAINTEXT_BYTES = 64 * 1024;
export const MAX_NESTING_DEPTH = 64;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function header(byte: number, value: number, width: 1 | 2 | 4): Uint8Array {
  const output = new Uint8Array(1 + width);
  output[0] = byte;
  const view = new DataView(output.buffer);
  if (width === 1) view.setUint8(1, value);
  if (width === 2) view.setUint16(1, value, false);
  if (width === 4) view.setUint32(1, value, false);
  return output;
}

function encodeInteger(value: number): Uint8Array {
  if (!Number.isSafeInteger(value)) throw new TypeError('JSON integer is outside the safe range');
  if (value >= 0) {
    if (value <= 0x7f) return Uint8Array.of(value);
    if (value <= 0xff) return header(0xcc, value, 1);
    if (value <= 0xffff) return header(0xcd, value, 2);
    if (value <= 0xffffffff) return header(0xce, value, 4);
    const output = new Uint8Array(9);
    output[0] = 0xcf;
    new DataView(output.buffer).setBigUint64(1, BigInt(value), false);
    return output;
  }
  if (value >= -32) return Uint8Array.of(0x100 + value);
  if (value >= -0x80) {
    const output = Uint8Array.of(0xd0, 0);
    new DataView(output.buffer).setInt8(1, value);
    return output;
  }
  if (value >= -0x8000) {
    const output = new Uint8Array(3);
    output[0] = 0xd1;
    new DataView(output.buffer).setInt16(1, value, false);
    return output;
  }
  if (value >= -0x80000000) {
    const output = new Uint8Array(5);
    output[0] = 0xd2;
    new DataView(output.buffer).setInt32(1, value, false);
    return output;
  }
  const output = new Uint8Array(9);
  output[0] = 0xd3;
  new DataView(output.buffer).setBigInt64(1, BigInt(value), false);
  return output;
}

function encodeString(value: string): Uint8Array {
  const bytes = utf8(value);
  let prefix: Uint8Array;
  if (bytes.length <= 31) prefix = Uint8Array.of(0xa0 | bytes.length);
  else if (bytes.length <= 0xff) prefix = header(0xd9, bytes.length, 1);
  else if (bytes.length <= 0xffff) prefix = header(0xda, bytes.length, 2);
  else prefix = header(0xdb, bytes.length, 4);
  return concatBytes(prefix, bytes);
}

function encodeValue(value: unknown, depth: number, ancestors: Set<object>): Uint8Array {
  if (depth > MAX_NESTING_DEPTH) throw new RangeError('MessagePack nesting exceeds 64');
  if (value === null) return Uint8Array.of(0xc0);
  if (value === false) return Uint8Array.of(0xc2);
  if (value === true) return Uint8Array.of(0xc3);
  if (typeof value === 'string') return encodeString(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON numbers must be finite');
    if (Number.isInteger(value)) return encodeInteger(value);
    const output = new Uint8Array(9);
    output[0] = 0xcb;
    new DataView(output.buffer).setFloat64(1, value, false);
    return output;
  }
  if (typeof value !== 'object') throw new TypeError('value is outside the JSON data model');
  if (ancestors.has(value)) throw new TypeError('cyclic values are not JSON');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const length = value.length;
      const prefix = length <= 15
        ? Uint8Array.of(0x90 | length)
        : length <= 0xffff ? header(0xdc, length, 2) : header(0xdd, length, 4);
      return concatBytes(prefix, ...value.map((item) => encodeValue(item, depth + 1, ancestors)));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('only plain JSON objects are supported');
    }
    const entries = Object.entries(value as Record<string, unknown>);
    const prefix = entries.length <= 15
      ? Uint8Array.of(0x80 | entries.length)
      : entries.length <= 0xffff ? header(0xde, entries.length, 2) : header(0xdf, entries.length, 4);
    const fields: Uint8Array[] = [prefix];
    for (const [key, item] of entries) {
      fields.push(encodeString(key), encodeValue(item, depth + 1, ancestors));
    }
    return concatBytes(...fields);
  } finally {
    ancestors.delete(value);
  }
}

export function encodeJsonMessagePack(value: unknown): Uint8Array {
  const encoded = encodeValue(value, 0, new Set());
  if (encoded.length > MAX_PLAINTEXT_BYTES) throw new RangeError('MessagePack plaintext exceeds 64 KiB');
  return encoded;
}

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number { return this.bytes.length - this.offset; }

  private take(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
      throw new RangeError('truncated MessagePack');
    }
    const output = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return output;
  }

  private byte(): number { return this.take(1)[0]!; }
  private u16(): number { const v = this.take(2); return new DataView(v.buffer, v.byteOffset, 2).getUint16(0, false); }
  private u32(): number { const v = this.take(4); return new DataView(v.buffer, v.byteOffset, 4).getUint32(0, false); }

  private string(length: number): string {
    return utf8String(this.take(length));
  }

  private array(length: number, depth: number): JsonValue[] {
    if (length > this.remaining) throw new RangeError('invalid MessagePack array length');
    return Array.from({ length }, () => this.value(depth + 1));
  }

  private map(length: number, depth: number): { [key: string]: JsonValue } {
    if (length > Math.floor(this.remaining / 2)) throw new RangeError('invalid MessagePack map length');
    const result: { [key: string]: JsonValue } = Object.create(null);
    const keys = new Set<string>();
    for (let index = 0; index < length; index++) {
      const key = this.value(depth + 1);
      if (typeof key !== 'string') throw new TypeError('MessagePack map keys must be strings');
      if (keys.has(key)) throw new TypeError('duplicate MessagePack map key');
      keys.add(key);
      result[key] = this.value(depth + 1);
    }
    return result;
  }

  value(depth: number): JsonValue {
    if (depth > MAX_NESTING_DEPTH) throw new RangeError('MessagePack nesting exceeds 64');
    const marker = this.byte();
    if (marker <= 0x7f) return marker;
    if (marker >= 0xe0) return marker - 0x100;
    if ((marker & 0xe0) === 0xa0) return this.string(marker & 0x1f);
    if ((marker & 0xf0) === 0x90) return this.array(marker & 0x0f, depth);
    if ((marker & 0xf0) === 0x80) return this.map(marker & 0x0f, depth);
    if (marker === 0xc0) return null;
    if (marker === 0xc2) return false;
    if (marker === 0xc3) return true;
    if (marker === 0xcc) {
      const value = this.byte();
      if (value <= 0x7f) throw new TypeError('non-shortest MessagePack integer');
      return value;
    }
    if (marker === 0xcd) {
      const value = this.u16();
      if (value <= 0xff) throw new TypeError('non-shortest MessagePack integer');
      return value;
    }
    if (marker === 0xce) {
      const value = this.u32();
      if (value <= 0xffff) throw new TypeError('non-shortest MessagePack integer');
      return value;
    }
    if (marker === 0xcf) {
      const bytes = this.take(8);
      const value = new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, false);
      if (value <= 0xffffffffn || value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new TypeError('invalid MessagePack uint64 for JSON');
      }
      return Number(value);
    }
    if (marker === 0xd0) {
      const bytes = this.take(1);
      const value = new DataView(bytes.buffer, bytes.byteOffset, 1).getInt8(0);
      if (value >= -32) throw new TypeError('non-shortest MessagePack integer');
      return value;
    }
    if (marker === 0xd1) {
      const bytes = this.take(2);
      const value = new DataView(bytes.buffer, bytes.byteOffset, 2).getInt16(0, false);
      if (value >= -0x80) throw new TypeError('non-shortest MessagePack integer');
      return value;
    }
    if (marker === 0xd2) {
      const bytes = this.take(4);
      const value = new DataView(bytes.buffer, bytes.byteOffset, 4).getInt32(0, false);
      if (value >= -0x8000) throw new TypeError('non-shortest MessagePack integer');
      return value;
    }
    if (marker === 0xd3) {
      const bytes = this.take(8);
      const value = new DataView(bytes.buffer, bytes.byteOffset, 8).getBigInt64(0, false);
      if (value >= -0x80000000n || value < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new TypeError('invalid MessagePack int64 for JSON');
      }
      return Number(value);
    }
    if (marker === 0xcb) {
      const bytes = this.take(8);
      const value = new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, false);
      if (!Number.isFinite(value) || Number.isInteger(value)) {
        throw new TypeError('invalid MessagePack float64 for JSON profile');
      }
      return value;
    }
    if (marker === 0xd9) return this.string(this.byte());
    if (marker === 0xda) return this.string(this.u16());
    if (marker === 0xdb) return this.string(this.u32());
    if (marker === 0xdc) return this.array(this.u16(), depth);
    if (marker === 0xdd) return this.array(this.u32(), depth);
    if (marker === 0xde) return this.map(this.u16(), depth);
    if (marker === 0xdf) return this.map(this.u32(), depth);
    throw new TypeError(`MessagePack type 0x${marker.toString(16)} is outside the JSON profile`);
  }
}

export function decodeJsonMessagePack(bytes: Uint8Array): JsonValue {
  if (bytes.length > MAX_PLAINTEXT_BYTES) throw new RangeError('MessagePack plaintext exceeds 64 KiB');
  const reader = new Reader(bytes);
  const value = reader.value(0);
  if (reader.remaining !== 0) throw new TypeError('trailing MessagePack bytes');
  return value;
}
