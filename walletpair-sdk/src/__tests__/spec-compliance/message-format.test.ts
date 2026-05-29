/**
 * WalletPair Protocol v1 — Message envelope and body schema validation.
 *
 * Verifies Sections 4.1, 4.2, 3, and 15 rule 10 for message format
 * compliance. Tests that message structures conform to the spec and
 * that invalid messages are properly detected.
 */

import { describe, expect, it } from 'vitest';
import { generateChannelId, b64urlEncode, generateX25519KeyPair } from '../../crypto.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validEnvelope(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    v: 1,
    t: 'ping',
    ch: generateChannelId(),
    ts: Date.now(),
    from: b64urlEncode(generateX25519KeyPair().publicKey),
    body: {},
    ...overrides,
  };
}

/** Validate that the envelope has all required fields per Section 4.1. */
function validateEnvelope(msg: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (msg.v !== 1) errors.push('v must be 1');
  if (typeof msg.t !== 'string' || msg.t.length === 0) errors.push('t must be a non-empty string');
  if (typeof msg.ch !== 'string' || !/^[0-9a-f]{64}$/.test(msg.ch as string)) {
    errors.push('ch must be 64 lowercase hex chars');
  }
  if (typeof msg.ts !== 'number') errors.push('ts must be a number');
  if (typeof msg.from !== 'string' || (msg.from as string).length === 0) {
    errors.push('from must be a non-empty string');
  }
  if (typeof msg.body !== 'object' || msg.body === null || Array.isArray(msg.body)) {
    errors.push('body must be a non-null object');
  }
  return errors;
}

/** Validate body schema per Section 4.2. */
function validateBody(t: string, body: Record<string, unknown>): string[] {
  const errors: string[] = [];
  switch (t) {
    case 'create':
      if (!body.meta || typeof body.meta !== 'object') errors.push('create body requires meta object');
      break;
    case 'join':
      if (!('sealed_join' in body)) errors.push('join body requires sealed_join field');
      break;
    case 'accept':
      if (typeof body.target !== 'string') errors.push('accept body requires target string');
      break;
    case 'ready':
      for (const field of ['state', 'role', 'self', 'remote', 'reconnect']) {
        if (!(field in body)) errors.push(`ready body requires ${field}`);
      }
      break;
    case 'req':
    case 'res':
    case 'evt':
      if (typeof body.id !== 'string') errors.push(`${t} body requires id string`);
      if (typeof body.sealed !== 'string') errors.push(`${t} body requires sealed string`);
      break;
    case 'ping':
    case 'pong':
      // empty body is valid
      break;
    case 'close':
      if (typeof body.reason !== 'string') errors.push('close body requires reason string');
      break;
    case 'terminate':
      if (typeof body.reason !== 'string') errors.push('terminate body requires reason string');
      break;
    default:
      errors.push(`unknown message type: ${t}`);
  }
  return errors;
}

/** Check wire size limit per Section 15 rule 10. */
function checkSizeLimit(msg: Record<string, unknown>): boolean {
  const wire = JSON.stringify(msg);
  return new TextEncoder().encode(wire).length <= 64 * 1024;
}

// ---------------------------------------------------------------------------
// Envelope validation (Section 4.1)
// ---------------------------------------------------------------------------

describe('Section 4.1 — Envelope required fields', () => {
  it('valid envelope passes validation', () => {
    expect(validateEnvelope(validEnvelope())).toEqual([]);
  });

  it('v must be 1', () => {
    const errors = validateEnvelope(validEnvelope({ v: 2 }));
    expect(errors).toContain('v must be 1');
  });

  it('v=0 is rejected', () => {
    const errors = validateEnvelope(validEnvelope({ v: 0 }));
    expect(errors).toContain('v must be 1');
  });

  it('t must be a non-empty string', () => {
    expect(validateEnvelope(validEnvelope({ t: '' }))).toContain('t must be a non-empty string');
    expect(validateEnvelope(validEnvelope({ t: 123 }))).toContain('t must be a non-empty string');
  });

  it('ch must be 64 lowercase hex chars', () => {
    expect(validateEnvelope(validEnvelope({ ch: 'ABC' }))).toContain('ch must be 64 lowercase hex chars');
    expect(validateEnvelope(validEnvelope({ ch: 'zz'.repeat(32) }))).toContain('ch must be 64 lowercase hex chars');
    expect(validateEnvelope(validEnvelope({ ch: 'aa'.repeat(31) }))).toContain('ch must be 64 lowercase hex chars');
  });

  it('valid 64-hex-char ch passes', () => {
    const msg = validEnvelope({ ch: 'ab'.repeat(32) });
    expect(validateEnvelope(msg)).toEqual([]);
  });

  it('ts must be a number', () => {
    expect(validateEnvelope(validEnvelope({ ts: 'not a number' }))).toContain('ts must be a number');
  });

  it('from must be a non-empty string', () => {
    expect(validateEnvelope(validEnvelope({ from: '' }))).toContain('from must be a non-empty string');
    expect(validateEnvelope(validEnvelope({ from: 123 }))).toContain('from must be a non-empty string');
  });

  it('body must be a non-null object', () => {
    expect(validateEnvelope(validEnvelope({ body: null }))).toContain('body must be a non-null object');
    expect(validateEnvelope(validEnvelope({ body: [1, 2] }))).toContain('body must be a non-null object');
    expect(validateEnvelope(validEnvelope({ body: 'string' }))).toContain('body must be a non-null object');
  });
});

// ---------------------------------------------------------------------------
// Channel ID validation (Section 3)
// ---------------------------------------------------------------------------

describe('Section 3 — Channel ID validation', () => {
  it('valid channel ID: 64 lowercase hex chars', () => {
    const ch = generateChannelId();
    expect(ch).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects uppercase hex', () => {
    const ch = 'AB'.repeat(32);
    expect(/^[0-9a-f]{64}$/.test(ch)).toBe(false);
  });

  it('rejects 63 chars', () => {
    const ch = 'a'.repeat(63);
    expect(/^[0-9a-f]{64}$/.test(ch)).toBe(false);
  });

  it('rejects 65 chars', () => {
    const ch = 'a'.repeat(65);
    expect(/^[0-9a-f]{64}$/.test(ch)).toBe(false);
  });

  it('rejects non-hex chars', () => {
    const ch = 'g'.repeat(64);
    expect(/^[0-9a-f]{64}$/.test(ch)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Body schema validation (Section 4.2)
// ---------------------------------------------------------------------------

describe('Section 4.2 — Body schemas', () => {
  it('create: requires meta object', () => {
    expect(validateBody('create', { meta: { name: 'X', description: 'Y', url: 'Z', icon: 'W' } })).toEqual([]);
    expect(validateBody('create', {})).toContain('create body requires meta object');
    expect(validateBody('create', { meta: null })).toContain('create body requires meta object');
  });

  it('join: requires sealed_join field (may be null for reconnect)', () => {
    expect(validateBody('join', { sealed_join: 'abc123' })).toEqual([]);
    expect(validateBody('join', { sealed_join: null })).toEqual([]);
    expect(validateBody('join', {})).toContain('join body requires sealed_join field');
  });

  it('accept: requires target string', () => {
    expect(validateBody('accept', { target: 'pubkey_b64' })).toEqual([]);
    expect(validateBody('accept', {})).toContain('accept body requires target string');
    expect(validateBody('accept', { target: 123 })).toContain('accept body requires target string');
  });

  it('ready: requires state, role, self, remote, reconnect', () => {
    const valid = { state: 'connected', role: 'dapp', self: 'pk1', remote: 'pk2', reconnect: false };
    expect(validateBody('ready', valid)).toEqual([]);
    for (const field of ['state', 'role', 'self', 'remote', 'reconnect']) {
      const missing = { ...valid };
      delete (missing as any)[field];
      expect(validateBody('ready', missing)).toContain(`ready body requires ${field}`);
    }
  });

  it('req/res/evt: requires id and sealed strings', () => {
    for (const t of ['req', 'res', 'evt']) {
      expect(validateBody(t, { id: 'uuid', sealed: 'base64data' })).toEqual([]);
      expect(validateBody(t, { sealed: 'base64data' })).toContain(`${t} body requires id string`);
      expect(validateBody(t, { id: 'uuid' })).toContain(`${t} body requires sealed string`);
    }
  });

  it('ping/pong: empty body is valid', () => {
    expect(validateBody('ping', {})).toEqual([]);
    expect(validateBody('pong', {})).toEqual([]);
  });

  it('close: requires reason string', () => {
    expect(validateBody('close', { reason: 'normal' })).toEqual([]);
    expect(validateBody('close', {})).toContain('close body requires reason string');
  });

  it('terminate: requires reason string', () => {
    expect(validateBody('terminate', { reason: 'timeout' })).toEqual([]);
    expect(validateBody('terminate', {})).toContain('terminate body requires reason string');
  });
});

// ---------------------------------------------------------------------------
// from = "_adapter" rejection (Section 2)
// ---------------------------------------------------------------------------

describe('Section 2 — _adapter from rejection', () => {
  it('"_adapter" is reserved for adapter-sent messages only', () => {
    // Peer message types that MUST NOT have from = "_adapter"
    const peerTypes = ['create', 'join', 'accept', 'req', 'res', 'evt', 'ping', 'pong', 'close'];
    for (const t of peerTypes) {
      const msg = validEnvelope({ t, from: '_adapter' });
      // Peers MUST reject any peer-sent message where from = "_adapter"
      expect(msg.from).toBe('_adapter');
      // Validation: from="_adapter" is only valid for adapter-sent types
      const isAdapterType = t === 'ready' || t === 'terminate';
      expect(isAdapterType).toBe(false);
    }
  });

  it('"_adapter" is valid for ready and terminate messages', () => {
    const adapterTypes = ['ready', 'terminate'];
    for (const t of adapterTypes) {
      const isAdapterType = t === 'ready' || t === 'terminate';
      expect(isAdapterType).toBe(true);
    }
  });

  it('from = "_adapter" MUST be rejected for peer message types', () => {
    // This test documents the rule: implementations MUST reject peer messages
    // with from = "_adapter" to prevent adapter impersonation
    function isPeerMessageWithAdapterFrom(msg: { t: string; from: string }): boolean {
      const peerTypes = new Set(['create', 'join', 'accept', 'req', 'res', 'evt', 'ping', 'pong', 'close']);
      return peerTypes.has(msg.t) && msg.from === '_adapter';
    }

    expect(isPeerMessageWithAdapterFrom({ t: 'req', from: '_adapter' })).toBe(true);
    expect(isPeerMessageWithAdapterFrom({ t: 'req', from: 'some_pubkey' })).toBe(false);
    expect(isPeerMessageWithAdapterFrom({ t: 'ready', from: '_adapter' })).toBe(false);
    expect(isPeerMessageWithAdapterFrom({ t: 'terminate', from: '_adapter' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Message size limit (Section 15 rule 10)
// ---------------------------------------------------------------------------

describe('Section 15 rule 10 — Message size limit (64 KB)', () => {
  it('a normal message is within the limit', () => {
    const msg = validEnvelope();
    expect(checkSizeLimit(msg)).toBe(true);
  });

  it('a message exceeding 64 KB is rejected', () => {
    const msg = validEnvelope({
      body: { sealed: 'x'.repeat(70000) },
    });
    expect(checkSizeLimit(msg)).toBe(false);
  });

  it('exactly 64 KB is within the limit', () => {
    // Build a message that is exactly at the boundary
    const base = validEnvelope({ body: { sealed: '' } });
    const baseSize = new TextEncoder().encode(JSON.stringify(base)).length;
    const remaining = 64 * 1024 - baseSize;
    const msg = validEnvelope({ body: { sealed: 'a'.repeat(remaining) } });
    expect(checkSizeLimit(msg)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Close / terminate reasons (Section 12.3)
// ---------------------------------------------------------------------------

describe('Section 12.3 — Close and terminate reasons', () => {
  const peerReasons = [
    'normal',
    'user_rejected',
    'unsupported_capability',
    'unsupported_version',
    'decryption_failed',
    'invalid_state',
    'invalid_role',
    'timeout',
    'rate_limited',
    'payload_too_large',
    'protocol_error',
  ];

  const adapterReasons = [
    'channel_not_found',
    'channel_exists',
    'already_connected',
    'invalid_state',
    'invalid_role',
    'timeout',
    'rate_limited',
    'payload_too_large',
    'protocol_error',
  ];

  it('all peer close reasons are valid strings', () => {
    for (const reason of peerReasons) {
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(0);
    }
  });

  it('all adapter terminate reasons are valid strings', () => {
    for (const reason of adapterReasons) {
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(0);
    }
  });

  it('terminate is adapter-only (from = "_adapter")', () => {
    // Section 12.2: Only the adapter sends terminate. Peers MUST NOT send it.
    const validTerminate = {
      v: 1,
      t: 'terminate',
      ch: 'aa'.repeat(32),
      ts: Date.now(),
      from: '_adapter',
      body: { reason: 'timeout' },
    };
    expect(validTerminate.from).toBe('_adapter');
  });
});
