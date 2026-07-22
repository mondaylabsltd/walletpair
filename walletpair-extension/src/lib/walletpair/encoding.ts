const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function utf8(value: string): Uint8Array {
  return encoder.encode(value);
}

export function utf8String(value: Uint8Array): string {
  return decoder.decode(value);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function uint16be(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError('uint16 out of range');
  }
  return Uint8Array.of(value >>> 8, value & 0xff);
}

export function uint32be(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError('uint32 out of range');
  }
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, false);
  return output;
}

export function readUint32be(value: Uint8Array): number {
  if (value.length !== 4) throw new RangeError('uint32 requires four bytes');
  return new DataView(value.buffer, value.byteOffset, 4).getUint32(0, false);
}

export function lp(value: string): Uint8Array {
  const bytes = utf8(value);
  if (bytes.length > 0xffff) throw new RangeError('length-prefixed value is too long');
  return concatBytes(uint16be(bytes.length), bytes);
}

export function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(value: string, expectedBytes?: number): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/.test(value)) throw new TypeError('invalid canonical lowercase hex');
  if (expectedBytes !== undefined && value.length !== expectedBytes * 2) {
    throw new RangeError(`expected ${expectedBytes} bytes`);
  }
  const output = new Uint8Array(value.length / 2);
  for (let index = 0; index < output.length; index++) {
    output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return output;
}

export function bytesToBase64Url(value: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(value: string, expectedBytes?: number): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new TypeError('invalid canonical base64url');
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new TypeError('invalid base64url');
  }
  const output = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytesToBase64Url(output) !== value) throw new TypeError('non-canonical base64url');
  if (expectedBytes !== undefined && output.length !== expectedBytes) {
    throw new RangeError(`expected ${expectedBytes} bytes`);
  }
  return output;
}

export function isAllZero(value: Uint8Array): boolean {
  let combined = 0;
  for (const byte of value) combined |= byte;
  return combined === 0;
}

export function randomBytes(length: number): Uint8Array {
  const output = new Uint8Array(length);
  crypto.getRandomValues(output);
  return output;
}

export function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function utf8Length(value: string): number {
  return utf8(value).length;
}
