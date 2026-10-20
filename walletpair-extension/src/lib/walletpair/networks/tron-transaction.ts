// TRON's Transaction.raw protocol buffer: just enough to check a transaction
// before signing and to show what it does (spec/networks/tron.md §2.1).

export const MAX_RAW_BYTES = 65_536;

export interface TronRaw {
  expiration?: bigint;
  timestamp?: bigint;
  contract: {
    type: number;
    typeUrl?: string;
    /** The parameter's owner_address (field 1), 21 bytes starting with 0x41, if present. */
    owner?: Uint8Array;
    permissionId: number;
    /** The encoded contract parameter, for display. */
    value: Uint8Array;
  };
}

type Field = { number: number; varint?: bigint; bytes?: Uint8Array };

/** Splits a message into fields; throws on anything malformed. */
function fields(bytes: Uint8Array): Field[] {
  const out: Field[] = [];
  let offset = 0;
  const varint = (): bigint => {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (offset >= bytes.length) throw new RangeError('truncated varint');
      const byte = bytes[offset++];
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
    }
    throw new RangeError('varint too long');
  };
  const take = (length: number): Uint8Array => {
    if (offset + length > bytes.length) throw new RangeError('truncated field');
    const slice = bytes.subarray(offset, offset + length);
    offset += length;
    return slice;
  };
  while (offset < bytes.length) {
    const key = varint();
    const number = Number(key >> 3n);
    if (number < 1) throw new RangeError('field number 0');
    switch (Number(key & 7n)) {
      case 0:
        out.push({ number, varint: varint() });
        break;
      case 1:
        out.push({ number, bytes: take(8) });
        break;
      case 2:
        out.push({ number, bytes: take(Number(varint())) });
        break;
      case 5:
        out.push({ number, bytes: take(4) });
        break;
      default:
        throw new RangeError('unsupported wire type');
    }
  }
  return out;
}

const signed64 = (value: bigint): bigint => BigInt.asIntN(64, value);

/** Decodes Transaction.raw with exactly one contract, or returns null. */
export function parseTronRaw(bytes: Uint8Array): TronRaw | null {
  if (bytes.length < 1 || bytes.length > MAX_RAW_BYTES) return null;
  try {
    const raw = fields(bytes);
    const contracts = raw.filter((f) => f.number === 11);
    if (contracts.length !== 1 || !contracts[0].bytes) return null;
    const tx: Partial<TronRaw> = {};
    for (const f of raw) {
      if (f.number === 8 && f.varint !== undefined) tx.expiration = signed64(f.varint);
      if (f.number === 14 && f.varint !== undefined) tx.timestamp = signed64(f.varint);
    }

    let type = 0;
    let permissionId = 0;
    let parameter: Uint8Array | undefined;
    for (const f of fields(contracts[0].bytes)) {
      if (f.number === 1 && f.varint !== undefined) type = Number(f.varint);
      if (f.number === 2 && f.bytes) parameter = f.bytes;
      if (f.number === 5 && f.varint !== undefined) permissionId = Number(f.varint);
    }
    if (!parameter) return null;

    let typeUrl: string | undefined;
    let value: Uint8Array | undefined;
    for (const f of fields(parameter)) {
      if (f.number === 1 && f.bytes) typeUrl = new TextDecoder().decode(f.bytes);
      if (f.number === 2 && f.bytes) value = f.bytes;
    }
    if (!value) return null;
    const owner = fields(value).find((f) => f.number === 1 && f.bytes?.length === 21 && f.bytes[0] === 0x41)?.bytes;
    return { ...tx, contract: { type, typeUrl, owner, permissionId, value } };
  } catch {
    return null;
  }
}
