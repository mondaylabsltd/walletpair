import { describe, expect, it } from 'vitest';
import { decodeJsonMessagePack, encodeJsonMessagePack } from '../msgpack';

describe('JSON-only MessagePack profile', () => {
  it('round-trips every JSON value kind', () => {
    const value = {
      nil: null,
      yes: true,
      no: false,
      text: '钱包',
      integers: [0, 127, 128, 65_536, -1, -33, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
      floats: [1.5, -0.25],
      nested: { array: ['x'] },
    };
    expect(decodeJsonMessagePack(encodeJsonMessagePack(value))).toEqual(value);
  });

  it('rejects non-JSON values, unsafe numbers, excessive depth and size', () => {
    expect(() => encodeJsonMessagePack({ missing: undefined })).toThrow(/JSON data model/);
    expect(() => encodeJsonMessagePack(Number.NaN)).toThrow(/finite/);
    expect(() => encodeJsonMessagePack(Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe range/);

    let nested: unknown = null;
    for (let i = 0; i < 65; i++) nested = [nested];
    expect(() => encodeJsonMessagePack(nested)).toThrow(/nesting/);
    expect(() => encodeJsonMessagePack('x'.repeat(65_536))).toThrow(/64 KiB/);
  });

  it('rejects duplicate keys, non-shortest integers and forbidden MessagePack types', () => {
    // { "a": 1, "a": 2 }
    expect(() => decodeJsonMessagePack(Uint8Array.of(0x82, 0xa1, 0x61, 0x01, 0xa1, 0x61, 0x02)))
      .toThrow(/duplicate/);
    // uint8(1) should have used positive fixint.
    expect(() => decodeJsonMessagePack(Uint8Array.of(0xcc, 0x01))).toThrow(/shortest/);
    // bin8 is outside the JSON profile.
    expect(() => decodeJsonMessagePack(Uint8Array.of(0xc4, 0x01, 0x00))).toThrow(/outside/);
    // float64 encoding of an integer is forbidden by the profile.
    const floatInteger = new Uint8Array(9);
    floatInteger[0] = 0xcb;
    new DataView(floatInteger.buffer).setFloat64(1, 1, false);
    expect(() => decodeJsonMessagePack(floatInteger)).toThrow(/float64/);
  });

  it('rejects invalid UTF-8 and trailing bytes', () => {
    expect(() => decodeJsonMessagePack(Uint8Array.of(0xa1, 0xff))).toThrow();
    expect(() => decodeJsonMessagePack(Uint8Array.of(0xc0, 0xc0))).toThrow(/trailing/);
  });
});
