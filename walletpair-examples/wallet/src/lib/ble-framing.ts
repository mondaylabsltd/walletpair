/**
 * BLE message framing per WalletPair Protocol Section 19.5.
 *
 * Frame format: [1 byte flags] [2 bytes total_length BE] [payload fragment]
 *
 *   flags bit 0: first fragment
 *   flags bit 1: last fragment
 *
 * Single-frame message: flags=0x03
 * Multi-frame first:    flags=0x01, total_length = full payload size
 * Multi-frame middle:   flags=0x00, total_length = 0
 * Multi-frame last:     flags=0x02, total_length = 0
 */

const FLAG_FIRST = 0x01;
const FLAG_LAST = 0x02;

/** Conservative max payload per fragment (typical BLE MTU 185 - 3 byte header). */
const MAX_FRAGMENT_PAYLOAD = 182;

// ---------------------------------------------------------------------------
// Fragmenting (sender side)
// ---------------------------------------------------------------------------

/** Split a JSON string into BLE frames ready for transmission. */
export function frameMessage(
  jsonStr: string,
  maxPayload = MAX_FRAGMENT_PAYLOAD,
): Uint8Array[] {
  const encoder = new TextEncoder();
  const payload = encoder.encode(jsonStr);
  const frames: Uint8Array[] = [];

  if (payload.length === 0) {
    // Edge case: empty message → single frame with empty payload
    const frame = new Uint8Array(3);
    frame[0] = FLAG_FIRST | FLAG_LAST;
    return [frame];
  }

  for (let offset = 0; offset < payload.length; offset += maxPayload) {
    const isFirst = offset === 0;
    const end = Math.min(offset + maxPayload, payload.length);
    const isLast = end === payload.length;
    const fragment = payload.slice(offset, end);

    const frame = new Uint8Array(3 + fragment.length);

    // Flags
    frame[0] = (isFirst ? FLAG_FIRST : 0) | (isLast ? FLAG_LAST : 0);

    // Total length (only meaningful in first fragment)
    if (isFirst) {
      frame[1] = (payload.length >> 8) & 0xff;
      frame[2] = payload.length & 0xff;
    }
    // Subsequent fragments: total_length = 0 (already zeroed)

    frame.set(fragment, 3);
    frames.push(frame);
  }

  return frames;
}

// ---------------------------------------------------------------------------
// Defragmenting (receiver side)
// ---------------------------------------------------------------------------

/** Accumulates BLE frames and emits complete JSON strings. */
export class Defragmenter {
  private chunks: Uint8Array[] = [];

  /**
   * Push a received BLE frame. Returns the complete JSON string when the
   * last fragment arrives, or null if more fragments are expected.
   */
  push(data: Uint8Array): string | null {
    if (data.length < 3) return null; // malformed

    const flags = data[0];
    const isFirst = !!(flags & FLAG_FIRST);
    const isLast = !!(flags & FLAG_LAST);
    const fragment = data.slice(3);

    if (isFirst) {
      this.chunks = [fragment];
    } else {
      this.chunks.push(fragment);
    }

    if (isLast) {
      const totalLength = this.chunks.reduce((s, c) => s + c.length, 0);
      const assembled = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of this.chunks) {
        assembled.set(chunk, offset);
        offset += chunk.length;
      }
      this.chunks = [];
      return new TextDecoder().decode(assembled);
    }

    return null; // more fragments expected
  }

  /** Reset internal buffer (e.g., on disconnect). */
  reset(): void {
    this.chunks = [];
  }
}

// ---------------------------------------------------------------------------
// BLE UUIDs (shared between dApp and wallet)
// ---------------------------------------------------------------------------

export const BLE_SERVICE_UUID = 'e3a10001-7770-4270-8000-000077700001';
/** dApp (Central) writes to this → wallet (Peripheral) receives. */
export const BLE_WRITE_CHAR_UUID = 'e3a10002-7770-4270-8000-000077700001';
/** Wallet (Peripheral) notifies on this → dApp (Central) receives. */
export const BLE_NOTIFY_CHAR_UUID = 'e3a10003-7770-4270-8000-000077700001';
