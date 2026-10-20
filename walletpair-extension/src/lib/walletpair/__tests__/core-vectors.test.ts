// Replays spec/test-vectors/core.json against the shared protocol module.
import { describe, expect, it } from 'vitest';
import vectors from '../../../../../spec/test-vectors/core.json';
import { parseFromWallet, parseRequest, parseState, type SessionState } from '../protocol';
import { dispose } from '../dispatch';
import { networkList, namespaceRules } from '../networks';

interface MessageCase {
  name: string;
  message?: unknown;
  text?: string;
  oversize?: number;
}

const encoder = new TextEncoder();

function bytesOf(c: MessageCase): Uint8Array {
  if (c.text !== undefined) return encoder.encode(c.text);
  if (c.oversize !== undefined) {
    const base = '{"id":"1","method":"wallet_getCallsStatus","params":[""]}';
    const padding = 'a'.repeat(c.oversize - encoder.encode(base).length);
    const bytes = encoder.encode(base.replace('[""]', `["${padding}"]`));
    expect(bytes.length).toBe(c.oversize);
    return bytes;
  }
  return encoder.encode(JSON.stringify(c.message));
}

const SAMPLE: SessionState = {
  eip155: { chain: 'eip155:1', accounts: ['0xd8da6bf26964af9d7eed9e03e53415d37aa96045'] },
  tron: { chain: 'tron:728126428', accounts: ['TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7'] },
  solana: {
    chain: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    accounts: ['7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv'],
  },
};

describe('core vectors: Wallet receives', () => {
  for (const c of vectors.wallet) {
    it(c.name, () => {
      const inbound = parseRequest(bytesOf(c));
      const expected = c.expect as { action: string; code?: number };
      if (inbound.kind === 'ignore') return expect(expected.action).toBe('ignore');
      if (inbound.kind === 'invalid') return expect(expected).toEqual({ action: 'error', code: -32600 });

      const state = Object.fromEntries(c.approved.map((ns) => [ns, SAMPLE[ns]]));
      const recorded = new Set<string>((c as { recorded?: string[] }).recorded ?? []);
      const outcome = dispose(inbound.request, { state, seen: (id) => recorded.has(id) }, networkList);
      if (outcome.action === 'error') expect(expected).toEqual({ action: 'error', code: outcome.error.code });
      else expect(expected.action).toBe(outcome.action);
    });
  }
});

describe('core vectors: DApp side receives', () => {
  for (const c of vectors.dapp) {
    it(c.name, () => {
      expect(parseFromWallet(bytesOf(c)).kind).toBe(c.expect.kind);
    });
  }
});

describe('core vectors: session state', () => {
  for (const c of vectors.state) {
    it(c.name, () => {
      const parsed = parseState(c.value, namespaceRules);
      expect(parsed).toEqual(c.expect === 'same' ? c.value : c.expect);
    });
  }
});
