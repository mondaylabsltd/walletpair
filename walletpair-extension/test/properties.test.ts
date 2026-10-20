// Property tests for everything a malicious peer or page can reach: parsers
// and checks must never throw, and what they accept must round-trip.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { WalletPairClient } from '../src/lib/walletpair/client';
import { bytesToHex, hexToBytes } from '../src/lib/walletpair/codec';
import { dispose } from '../src/lib/walletpair/dispatch';
import { namespaceRules, networkList } from '../src/lib/walletpair/networks';
import {
  MAX_MESSAGE_BYTES,
  encode,
  parseFromWallet,
  parseRequest,
  parseState,
  type Json,
  type Request,
  type SessionState,
} from '../src/lib/walletpair/protocol';
import { memoryPair, settle } from './memory-transport';

const RUNS = { numRuns: 500 };
const bytes = fc.uint8Array({ maxLength: 2048 });
const json = fc.jsonValue() as fc.Arbitrary<Json>;
const printable = fc.string({ unit: fc.constantFrom(...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))), minLength: 1, maxLength: 128 });
const encoder = new TextEncoder();

const SAMPLE: SessionState = {
  eip155: { chain: 'eip155:1', accounts: ['0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'] },
};
const methods = fc.constantFrom(
  'walletpair_connect',
  'walletpair_cancel',
  'eth_unknown',
  ...networkList.flatMap((n) => Object.keys(n.functions)),
);

describe('messages', () => {
  it('parsing arbitrary bytes or JSON never throws', () => {
    fc.assert(
      fc.property(fc.oneof(bytes, json.map((v) => encoder.encode(JSON.stringify(v)))), (input) => {
        parseRequest(input);
        parseFromWallet(input);
      }),
      RUNS,
    );
  });

  it('a valid request round-trips through the wire', () => {
    const request = fc.record(
      { id: printable, method: printable, params: fc.oneof(fc.array(json), fc.dictionary(fc.string(), json)), origin: fc.constant('https://app.example') },
      { requiredKeys: ['id', 'method'] },
    );
    fc.assert(
      fc.property(request, (r) => {
        // Compared as JSON text: JSON has no -0, so it comes back as 0.
        const parsed = parseRequest(encode(r as Request));
        expect(JSON.stringify(parsed)).toBe(JSON.stringify({ kind: 'request', request: r }));
      }),
      RUNS,
    );
  });

  it('a response round-trips through the wire', () => {
    const response = fc.oneof(
      fc.record({ id: printable, result: json }),
      fc.record({ id: printable, error: fc.record({ code: fc.integer(), message: fc.string() }) }),
    );
    fc.assert(
      fc.property(response, (r) => {
        // Compared as JSON text: JSON has no -0, so it comes back as 0.
        expect(JSON.stringify(parseFromWallet(encode(r)))).toBe(JSON.stringify({ kind: 'response', response: r }));
      }),
      RUNS,
    );
  });

  it('refuses to encode more than 1 MiB', () => {
    const big = { id: '1', method: 'x', params: ['a'.repeat(MAX_MESSAGE_BYTES)] };
    expect(() => encode(big)).toThrow(RangeError);
  });

  it('a Wallet decides every request without throwing, whatever its params', () => {
    const request = fc.record({ id: printable, method: methods, params: fc.option(fc.oneof(fc.array(json), fc.dictionary(fc.string(), json)), { nil: undefined }) });
    const approved = fc.subarray(['eip155']);
    fc.assert(
      fc.property(request, approved, fc.boolean(), (r, namespaces, seen) => {
        const state = Object.fromEntries(namespaces.map((ns) => [ns, SAMPLE[ns]]));
        const outcome = dispose(r as Request, { state, seen: () => seen }, networkList);
        expect(['repeat', 'error', 'connect', 'cancel', 'perform']).toContain(outcome.action);
      }),
      { numRuns: 2000 },
    );
  });

  it('every network check returns an error or null for arbitrary params', () => {
    for (const network of networkList) {
      for (const [method, fn] of Object.entries(network.functions)) {
        fc.assert(
          fc.property(fc.option(fc.oneof(fc.array(json), fc.dictionary(fc.string(), json), fc.array(fc.string())), { nil: undefined }), (params) => {
            const refused = fn.check(params as never, SAMPLE[network.namespace]);
            if (refused) expect(Number.isInteger(refused.code), method).toBe(true);
          }),
          { numRuns: 300 },
        );
      }
    }
  });

  it('parsing a session state never throws and keeps only known namespaces', () => {
    fc.assert(
      fc.property(fc.oneof(json, fc.constant(SAMPLE as unknown as Json)), (value) => {
        const state = parseState(value, namespaceRules);
        if (state) for (const ns of Object.keys(state)) expect(namespaceRules[ns]).toBeDefined();
      }),
      RUNS,
    );
  });

  it('a client fed arbitrary messages never throws and stays consistent', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.oneof(bytes, json.map((v) => encoder.encode(JSON.stringify(v)))), { maxLength: 30 }), async (inbound) => {
        const [dappEnd, walletEnd] = memoryPair();
        const client = new WalletPairClient(dappEnd, namespaceRules);
        const pending = client.call('personal_sign', ['0x00', SAMPLE.eip155.accounts[0]]).catch(() => {});
        for (const message of inbound) walletEnd.send(message);
        await settle();
        expect(client.ended).toBe(false);
        void pending;
      }),
      { numRuns: 200 },
    );
  });
});

describe('encodings', () => {
  it('hex round-trips', () => {
    fc.assert(
      fc.property(bytes, (b) => {
        expect(hexToBytes(bytesToHex(b))).toEqual(b);
      }),
      RUNS,
    );
  });
});
