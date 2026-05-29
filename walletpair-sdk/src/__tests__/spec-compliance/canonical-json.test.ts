/**
 * WalletPair Protocol v1 — Section 6.3 canonical JSON test vectors.
 *
 * Verifies that the SDK's canonicalJson implementation matches every
 * test vector in the specification, including SHA-256 hashes, and
 * handles all documented edge cases.
 */

import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256Hex } from '../../crypto.js'

function hash(s: string): string {
  return sha256Hex(new TextEncoder().encode(s))
}

// ---------------------------------------------------------------------------
// Section 6.3 — Normative test vectors
// ---------------------------------------------------------------------------

describe('Section 6.3 — Vector 1: capabilities (key sorting, nested objects)', () => {
  const input = {
    methods: ['wallet_signTransaction', 'wallet_signMessage'],
    events: ['accountsChanged', 'chainChanged'],
    chains: ['eip155:1', 'eip155:137'],
  }
  const expected =
    '{"chains":["eip155:1","eip155:137"],"events":["accountsChanged","chainChanged"],"methods":["wallet_signTransaction","wallet_signMessage"]}'
  const expectedHash = '4da366e2aae26b47b3d90fff52410752348733350ce2525dce7d64510f571333'

  it('produces the correct canonical output', () => {
    expect(canonicalJson(input)).toBe(expected)
  })

  it('SHA-256 of output matches the spec', () => {
    expect(hash(canonicalJson(input))).toBe(expectedHash)
  })
})

describe('Section 6.3 — Vector 2: join plaintext (nested + meta)', () => {
  const input = {
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
  }
  const expected =
    '{"capabilities":{"chains":["eip155:1","eip155:137"],"events":["accountsChanged","chainChanged"],"methods":["wallet_signTransaction","wallet_signMessage"]},"meta":{"description":"A multi-chain wallet","icon":"https://mywallet.app/icon.png","name":"MyWallet","url":"https://mywallet.app"}}'
  const expectedHash = '9f4f3b71b0db39ba8b86173b8c78182799d0a745c68b6e89e5d8f0d3def52594'

  it('produces the correct canonical output', () => {
    expect(canonicalJson(input)).toBe(expected)
  })

  it('SHA-256 of output matches the spec', () => {
    expect(hash(canonicalJson(input))).toBe(expectedHash)
  })
})

describe('Section 6.3 — Vector 3: primitives', () => {
  it('null -> "null"', () => {
    const output = canonicalJson(null)
    expect(output).toBe('null')
    expect(hash(output)).toBe('74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b')
  })

  it('true -> "true"', () => {
    const output = canonicalJson(true)
    expect(output).toBe('true')
    expect(hash(output)).toBe('b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b')
  })

  it('42 -> "42"', () => {
    const output = canonicalJson(42)
    expect(output).toBe('42')
    expect(hash(output)).toBe('73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049')
  })

  it('"hello" -> \'"hello"\'', () => {
    const output = canonicalJson('hello')
    expect(output).toBe('"hello"')
    expect(hash(output)).toBe('5aa762ae383fbb727af3c7a36d4940a5b8c40a989452d2304fc958ff3f354e7a')
  })
})

describe('Section 6.3 — Vector 4: empty containers', () => {
  it('{} -> "{}"', () => {
    const output = canonicalJson({})
    expect(output).toBe('{}')
    expect(hash(output)).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a')
  })

  it('[] -> "[]"', () => {
    const output = canonicalJson([])
    expect(output).toBe('[]')
    expect(hash(output)).toBe('4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945')
  })
})

describe('Section 6.3 — Vector 5: negative zero', () => {
  it('-0 -> "0"', () => {
    const output = canonicalJson(-0)
    expect(output).toBe('0')
    expect(hash(output)).toBe('5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9')
  })
})

describe('Section 6.3 — Vector 6: escaped control character', () => {
  it('U+0001 -> "\\u0001" (lowercase hex)', () => {
    const output = canonicalJson('\u0001')
    expect(output).toBe('"\\u0001"')
    expect(hash(output)).toBe('b81cfb0a6715e53b373345b49e8ad94eb55fd777519dc539373d0634973c186e')
  })
})

// ---------------------------------------------------------------------------
// Edge cases from Section 6.3 rules
// ---------------------------------------------------------------------------

describe('Section 6.3 — Edge cases', () => {
  it('negative zero inside an object serializes as 0', () => {
    expect(canonicalJson({ value: -0 })).toBe('{"value":0}')
  })

  it('negative zero inside an array serializes as 0', () => {
    expect(canonicalJson([-0])).toBe('[0]')
  })

  it('NaN is rejected', () => {
    expect(() => canonicalJson(NaN)).toThrow()
  })

  it('Infinity is rejected', () => {
    expect(() => canonicalJson(Infinity)).toThrow()
    expect(() => canonicalJson(-Infinity)).toThrow()
  })

  it('forward slash is NOT escaped', () => {
    const output = canonicalJson('/')
    expect(output).toBe('"/"')
  })

  it('non-ASCII Unicode is output as literal UTF-8', () => {
    expect(canonicalJson('中文')).toBe('"中文"')
  })

  it('control characters U+0000-U+001F use correct escape forms', () => {
    // Short forms
    expect(canonicalJson('\b')).toBe('"\\b"')
    expect(canonicalJson('\t')).toBe('"\\t"')
    expect(canonicalJson('\n')).toBe('"\\n"')
    expect(canonicalJson('\f')).toBe('"\\f"')
    expect(canonicalJson('\r')).toBe('"\\r"')

    // All other C0 controls use lowercase \\uXXXX
    expect(canonicalJson('\x00')).toBe('"\\u0000"')
    expect(canonicalJson('\x01')).toBe('"\\u0001"')
    expect(canonicalJson('\x1f')).toBe('"\\u001f"')
  })

  it('\\uXXXX escapes use lowercase hex digits only', () => {
    for (let cp = 0; cp <= 0x1f; cp++) {
      const result = canonicalJson(String.fromCharCode(cp))
      // Verify no uppercase hex digits in any \u escape
      const matches = result.match(/\\u[0-9a-fA-F]{4}/g)
      if (matches) {
        for (const m of matches) {
          expect(m).toBe(m.toLowerCase())
        }
      }
    }
  })

  it('no whitespace in structural output', () => {
    const complex = {
      z: [3, 1, 2],
      a: { y: 'value', x: true },
      m: null,
    }
    const output = canonicalJson(complex)
    // Remove string content, then check structural chars only
    const structural = output.replace(/"[^"]*"/g, '""')
    expect(structural).not.toMatch(/\s/)
  })

  it('array order is preserved (NOT sorted)', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
  })

  it('object keys are sorted alphabetically at every nesting level', () => {
    const input = { z: { b: 2, a: 1 }, a: 0 }
    expect(canonicalJson(input)).toBe('{"a":0,"z":{"a":1,"b":2}}')
  })

  it('no trailing .0 on whole-number floats', () => {
    expect(canonicalJson(100.0)).toBe('100')
  })

  it('numbers have no leading zeroes or + prefix', () => {
    expect(canonicalJson(42)).toBe('42')
    expect(canonicalJson(0)).toBe('0')
    expect(canonicalJson(-1)).toBe('-1')
  })
})

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe('Section 6.3 — Idempotency', () => {
  it('parsing the canonical output and re-canonicalizing produces identical bytes', () => {
    const input = {
      methods: ['wallet_signTransaction', 'wallet_signMessage'],
      events: ['accountsChanged', 'chainChanged'],
      chains: ['eip155:1', 'eip155:137'],
    }
    const first = canonicalJson(input)
    const reparsed = JSON.parse(first)
    expect(canonicalJson(reparsed)).toBe(first)
  })
})
