/**
 * WalletPair Protocol v1 — Section 6.6.1 sequence number rules.
 *
 * Verifies sequence number validation logic independent of the session
 * classes, using pure functions that any implementation can replicate.
 */

import { describe, expect, it } from 'vitest'
import { b64urlDecode, bytesToHex, sealPayload, unsealPayload } from '../../crypto.js'

// ---------------------------------------------------------------------------
// Sequence number validator (pure model per Section 6.6.1)
// ---------------------------------------------------------------------------

/**
 * Tracks the highest accepted receive sequence number.
 * Per spec: initial value is -1 (no messages accepted yet).
 * A message MUST be rejected if its seq is not strictly greater than lastAccepted.
 */
class SequenceValidator {
  /** Highest accepted sequence number. -1 means none accepted yet. */
  private lastAccepted = -1

  /**
   * Attempt to accept a sequence number.
   * Returns true if accepted, false if rejected (replay/non-increasing).
   */
  accept(seq: number): boolean {
    if (seq <= this.lastAccepted) return false
    this.lastAccepted = seq
    return true
  }

  /** Current high watermark. */
  get highWatermark(): number {
    return this.lastAccepted
  }
}

/**
 * Tracks the send sequence counter.
 * Per spec: starts at 0, increments by 1 per sealed message.
 * Limit at 2^31.
 */
class SendSequence {
  private seq = 0

  /** Get the next sequence number for sending, or null if limit reached. */
  next(): number | null {
    if (this.seq >= 2 ** 31) return null
    return this.seq++
  }

  /** Current value (next seq that will be used). */
  get current(): number {
    return this.seq
  }

  /** Set the counter to a specific value (for testing). */
  setTo(n: number): void {
    this.seq = n
  }
}

// ---------------------------------------------------------------------------
// Section 6.6.1 — Basic sequence number rules
// ---------------------------------------------------------------------------

describe('Section 6.6.1 — Sequence number starts at 0', () => {
  it('first send sequence is 0', () => {
    const send = new SendSequence()
    expect(send.next()).toBe(0)
  })

  it('first accepted receive sequence can be 0', () => {
    const recv = new SequenceValidator()
    expect(recv.accept(0)).toBe(true)
    expect(recv.highWatermark).toBe(0)
  })
})

describe('Section 6.6.1 — Increments by 1', () => {
  it('send counter increments by 1 per message', () => {
    const send = new SendSequence()
    expect(send.next()).toBe(0)
    expect(send.next()).toBe(1)
    expect(send.next()).toBe(2)
    expect(send.next()).toBe(3)
  })

  it('receive validator accepts strictly increasing sequence', () => {
    const recv = new SequenceValidator()
    expect(recv.accept(0)).toBe(true)
    expect(recv.accept(1)).toBe(true)
    expect(recv.accept(2)).toBe(true)
    expect(recv.accept(3)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Replay rejection (non-increasing)
// ---------------------------------------------------------------------------

describe('Section 6.6.1 — Reject non-increasing (replay)', () => {
  it('rejects the same sequence number twice', () => {
    const recv = new SequenceValidator()
    expect(recv.accept(0)).toBe(true)
    expect(recv.accept(0)).toBe(false) // replay
  })

  it('rejects a lower sequence number after a higher one', () => {
    const recv = new SequenceValidator()
    expect(recv.accept(5)).toBe(true)
    expect(recv.accept(3)).toBe(false) // lower than watermark
    expect(recv.accept(4)).toBe(false) // still lower
    expect(recv.accept(5)).toBe(false) // equal to watermark
  })

  it('rejects seq=0 replay after initial acceptance', () => {
    const recv = new SequenceValidator()
    recv.accept(0)
    recv.accept(1)
    expect(recv.accept(0)).toBe(false)
  })

  it('multiple replays are all rejected', () => {
    const recv = new SequenceValidator()
    recv.accept(0)
    for (let i = 0; i < 10; i++) {
      expect(recv.accept(0)).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Gaps are valid (after reconnect)
// ---------------------------------------------------------------------------

describe('Section 6.6.1 — Gaps valid (expected after reconnect)', () => {
  it('accepts seq=0 then seq=5 (gap of 4)', () => {
    const recv = new SequenceValidator()
    expect(recv.accept(0)).toBe(true)
    expect(recv.accept(5)).toBe(true)
    expect(recv.highWatermark).toBe(5)
  })

  it('accepts large gaps', () => {
    const recv = new SequenceValidator()
    expect(recv.accept(0)).toBe(true)
    expect(recv.accept(1000)).toBe(true)
    expect(recv.accept(500000)).toBe(true)
  })

  it('rejects values within a gap after the gap is established', () => {
    const recv = new SequenceValidator()
    recv.accept(0)
    recv.accept(10)
    // All values 0-10 are now below the watermark
    for (let i = 0; i <= 10; i++) {
      expect(recv.accept(i)).toBe(false)
    }
    // 11 and above are accepted
    expect(recv.accept(11)).toBe(true)
  })

  it('gap from initial state (first message is not 0)', () => {
    const recv = new SequenceValidator()
    // After reconnect, the first message might not be seq=0
    expect(recv.accept(42)).toBe(true)
    expect(recv.highWatermark).toBe(42)
  })
})

// ---------------------------------------------------------------------------
// Limit at 2^31
// ---------------------------------------------------------------------------

describe('Section 6.6.1 — Limit at 2^31', () => {
  const LIMIT = 2 ** 31 // 2,147,483,648

  it('send counter allows 2^31 - 1 as the last valid sequence', () => {
    const send = new SendSequence()
    send.setTo(LIMIT - 1)
    expect(send.next()).toBe(LIMIT - 1)
  })

  it('send counter returns null (overflow) at 2^31', () => {
    const send = new SendSequence()
    send.setTo(LIMIT)
    expect(send.next()).toBeNull()
  })

  it('receive validator accepts up to 2^31 - 1', () => {
    const recv = new SequenceValidator()
    expect(recv.accept(LIMIT - 1)).toBe(true)
  })

  it('send counter reaches limit after 2^31 messages', () => {
    // Verify the math: starting at 0, after LIMIT sends, next() returns null
    const send = new SendSequence()
    send.setTo(LIMIT - 1)
    const lastValid = send.next()
    expect(lastValid).toBe(LIMIT - 1)
    expect(send.next()).toBeNull() // overflow
  })

  it('the limit is 2^31 not 2^32-1 (signed integer safety)', () => {
    // Section 6.6.1: "The limit is 2^31 rather than 2^32 - 1 to avoid
    // signed integer overflow in languages where 32-bit integers are signed."
    expect(LIMIT).toBe(2147483648)
    expect(LIMIT).toBeLessThan(2 ** 32 - 1)
  })
})

// ---------------------------------------------------------------------------
// Sequence persistence across reconnects
// ---------------------------------------------------------------------------

describe('Section 6.6.1 — Counters persist across reconnects', () => {
  it('simulated reconnect preserves send counter', () => {
    const send = new SendSequence()
    send.next() // 0
    send.next() // 1
    send.next() // 2
    const savedSeq = send.current // 3

    // Simulate reconnect: new SendSequence initialized from persisted state
    const restored = new SendSequence()
    restored.setTo(savedSeq)
    expect(restored.next()).toBe(3) // continues from where we left off
    expect(restored.next()).toBe(4)
  })

  it('simulated reconnect preserves receive watermark', () => {
    const recv = new SequenceValidator()
    recv.accept(0)
    recv.accept(1)
    recv.accept(2)
    const savedWatermark = recv.highWatermark // 2

    // Simulate reconnect: new SequenceValidator initialized from persisted state
    const restored = new SequenceValidator()
    // Set watermark by accepting the saved value
    restored.accept(savedWatermark)
    // Old sequences are rejected
    expect(restored.accept(0)).toBe(false)
    expect(restored.accept(1)).toBe(false)
    expect(restored.accept(2)).toBe(false)
    // New sequences are accepted
    expect(restored.accept(3)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// seq_bytes encoding in sealed messages
// ---------------------------------------------------------------------------

describe('Section 6.6 — seq_bytes is 4-byte big-endian in sealed messages', () => {
  const key = new Uint8Array(32).fill(0xaa)
  const ch = 'bb'.repeat(32)

  it('seq=0 encodes as 00000000', () => {
    const sealed = sealPayload(key, ch, 0, { test: true })
    const bytes = b64urlDecode(sealed)
    expect(bytesToHex(bytes.slice(0, 4))).toBe('00000000')
  })

  it('seq=1 encodes as 00000001', () => {
    const sealed = sealPayload(key, ch, 1, { test: true })
    const bytes = b64urlDecode(sealed)
    expect(bytesToHex(bytes.slice(0, 4))).toBe('00000001')
  })

  it('seq=256 encodes as 00000100', () => {
    const sealed = sealPayload(key, ch, 256, { test: true })
    const bytes = b64urlDecode(sealed)
    expect(bytesToHex(bytes.slice(0, 4))).toBe('00000100')
  })

  it('seq=2^31-1 encodes as 7fffffff', () => {
    const sealed = sealPayload(key, ch, 2 ** 31 - 1, { test: true })
    const bytes = b64urlDecode(sealed)
    expect(bytesToHex(bytes.slice(0, 4))).toBe('7fffffff')
  })

  it('round-trip: seq is correctly extracted from sealed payload', () => {
    for (const seq of [0, 1, 42, 1000, 65535, 2 ** 31 - 1]) {
      const sealed = sealPayload(key, ch, seq, { n: seq })
      const result = unsealPayload(key, ch, sealed)
      expect(result.seq).toBe(seq)
    }
  })
})
