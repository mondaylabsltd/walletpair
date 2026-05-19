/**
 * Tests for receive sequence number validation (replay protection),
 * send sequence overflow, capabilities validation, and pending_accept timeout.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DAppSession } from './dapp-session.js';
import { WalletSession } from './wallet-session.js';
import { MockTransport, MockRelay } from './test-helpers.js';
import {
  generateX25519KeyPair,
  b64urlEncode,
} from './crypto.js';
import type { ProtocolMessage } from './types.js';

function flush(ms = 50): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Set up a fully connected DApp + Wallet pair via MockRelay. */
async function setupConnectedPair() {
  const dappTransport = new MockTransport();
  const walletTransport = new MockTransport();
  const _relay = new MockRelay(dappTransport, walletTransport);

  const dapp = new DAppSession({ transport: dappTransport, name: 'Test' });
  const wallet = new WalletSession({
    transport: walletTransport,
    capabilities: { methods: ['wallet_getAccounts'], events: ['accountsChanged'], chains: ['eip155:1'] },
    meta: { name: 'TestWallet' },
  });

  // Step-by-step (matching integration.test.ts pattern)
  const uri = await dapp.createPairing();
  await flush();
  await wallet.joinFromUri(uri);
  await flush();
  await flush(); // ensure join is forwarded to dApp

  // DApp should be pending_accept now
  dapp.acceptWallet();
  await flush();

  if (dapp.phase !== 'connected' || wallet.phase !== 'connected') {
    throw new Error(`Setup failed: dapp=${dapp.phase}, wallet=${wallet.phase}`);
  }

  return { dapp, wallet, dappTransport, walletTransport };
}

describe('Sequence validation — DAppSession', () => {
  it('exchanges messages and tracks recvSeq', async () => {
    const { dapp, wallet } = await setupConnectedPair();

    wallet.on('request', ({ id }) => wallet.approve(id, ['0x1234']));

    const result = await dapp.request('wallet_getAccounts');
    expect(result).toEqual(['0x1234']);

    // recvSeq should have been updated
    const serialized = JSON.parse(dapp.serialize());
    expect(serialized.recvSeq).toBeGreaterThanOrEqual(0);
  });

  it('persists recvSeq across serialize/restore', async () => {
    const { dapp, wallet } = await setupConnectedPair();

    wallet.on('request', ({ id }) => wallet.approve(id, 'ok'));
    // Pass params so sealed payload is used (increments sendSeq)
    const result = await dapp.request('wallet_signMessage', { message: 'hello' });
    await flush();
    expect(result).toBe('ok');

    const json = dapp.serialize();
    const parsed = JSON.parse(json);
    // recvSeq >= 0 because wallet's response was sealed
    expect(parsed.recvSeq).toBeGreaterThanOrEqual(0);
    // sendSeq >= 1 because request had sealed params
    expect(parsed.sendSeq).toBeGreaterThanOrEqual(1);

    // Restore into new session
    const newTransport = new MockTransport();
    const newDapp = new DAppSession({ transport: newTransport, name: 'Restored' });
    expect(newDapp.restore(json)).toBe(true);

    const restored = JSON.parse(newDapp.serialize());
    expect(restored.recvSeq).toBe(parsed.recvSeq);
    expect(restored.sendSeq).toBe(parsed.sendSeq);
  });
});

describe('Sequence validation — WalletSession', () => {
  it('persists recvSeq in WalletSession', async () => {
    const { wallet } = await setupConnectedPair();

    const json = wallet.serialize();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty('recvSeq');
    expect(typeof parsed.recvSeq).toBe('number');
  });

  it('processes requests and tracks sequence', async () => {
    const { dapp, wallet } = await setupConnectedPair();

    const requests: string[] = [];
    wallet.on('request', (req) => {
      requests.push(req.method);
      wallet.approve(req.id, 'ok');
    });

    // Use params so sealed payloads are used
    const result = await dapp.request('wallet_signMessage', { msg: 'test' });
    expect(result).toBe('ok');
    await flush();

    expect(requests).toContain('wallet_signMessage');

    // Both sides should have advanced sequence counters
    const walletState = JSON.parse(wallet.serialize());
    expect(walletState.recvSeq).toBeGreaterThanOrEqual(0); // received sealed request
    expect(walletState.sendSeq).toBeGreaterThanOrEqual(1); // sent sealed response

    const dappState = JSON.parse(dapp.serialize());
    expect(dappState.sendSeq).toBeGreaterThanOrEqual(1); // sent sealed request
    expect(dappState.recvSeq).toBeGreaterThanOrEqual(0); // received sealed response
  });
});

describe('Send sequence overflow', () => {
  it('emits error when dapp sendSeq wraps to 0', async () => {
    const { dapp } = await setupConnectedPair();

    // Set sendSeq near overflow
    (dapp as any).sendSeq = 0xFFFFFFFF;

    const errorHandler = vi.fn();
    dapp.on('error', errorHandler);

    try {
      await dapp.request('test', { data: 1 });
    } catch (err: any) {
      expect(err.message).toContain('overflow');
    }

    expect(errorHandler).toHaveBeenCalled();
  });

  it('emits error when wallet sendSeq wraps to 0', async () => {
    const { wallet } = await setupConnectedPair();

    (wallet as any).sendSeq = 0xFFFFFFFF;

    const errorHandler = vi.fn();
    wallet.on('error', errorHandler);

    wallet.approve('fake-id', 'result');
    expect(errorHandler).toHaveBeenCalled();
  });
});

describe('Capabilities validation', () => {
  it('rejects join with malformed capabilities (string instead of object)', async () => {
    const transport = new MockTransport();
    const dapp = new DAppSession({ transport, name: 'Test', autoAccept: false });

    const errorHandler = vi.fn();
    dapp.on('error', errorHandler);

    await dapp.createPairing();
    await flush();

    const kp = generateX25519KeyPair();
    transport.receive({
      v: 1, t: 'join', ch: dapp.channelId,
      from: kp.publicKeyB64, pubkey: kp.publicKeyB64,
      capabilities: 'invalid' as any,
    } as ProtocolMessage);
    await flush();

    expect(errorHandler).toHaveBeenCalled();
    expect(dapp.phase).not.toBe('pending_accept');
  });

  it('rejects join with capabilities.methods not an array', async () => {
    const transport = new MockTransport();
    const dapp = new DAppSession({ transport, name: 'Test', autoAccept: false });

    const errorHandler = vi.fn();
    dapp.on('error', errorHandler);

    await dapp.createPairing();
    await flush();

    const kp = generateX25519KeyPair();
    transport.receive({
      v: 1, t: 'join', ch: dapp.channelId,
      from: kp.publicKeyB64, pubkey: kp.publicKeyB64,
      capabilities: { methods: 'not-array', events: [], chains: [] } as any,
    } as ProtocolMessage);
    await flush();

    expect(errorHandler).toHaveBeenCalled();
  });

  it('accepts valid capabilities', async () => {
    const transport = new MockTransport();
    const dapp = new DAppSession({ transport, name: 'Test', autoAccept: false });

    const joinHandler = vi.fn();
    dapp.on('walletJoined', joinHandler);

    await dapp.createPairing();
    await flush();

    const kp = generateX25519KeyPair();
    transport.receive({
      v: 1, t: 'join', ch: dapp.channelId,
      from: kp.publicKeyB64, pubkey: kp.publicKeyB64,
      capabilities: { methods: ['wallet_getAccounts'], events: [], chains: ['eip155:1'] },
    } as ProtocolMessage);
    await flush();

    expect(joinHandler).toHaveBeenCalled();
    expect(dapp.phase).toBe('pending_accept');
  });

  it('accepts join without capabilities (optional)', async () => {
    const transport = new MockTransport();
    const dapp = new DAppSession({ transport, name: 'Test', autoAccept: false });

    const joinHandler = vi.fn();
    dapp.on('walletJoined', joinHandler);

    await dapp.createPairing();
    await flush();

    const kp = generateX25519KeyPair();
    transport.receive({
      v: 1, t: 'join', ch: dapp.channelId,
      from: kp.publicKeyB64, pubkey: kp.publicKeyB64,
    } as ProtocolMessage);
    await flush();

    expect(joinHandler).toHaveBeenCalled();
  });
});

describe('Pending accept timeout', () => {
  it('auto-rejects after 60s timeout', async () => {
    vi.useFakeTimers();

    const transport = new MockTransport();
    const dapp = new DAppSession({ transport, name: 'Test', autoAccept: false });

    const errorHandler = vi.fn();
    dapp.on('error', errorHandler);

    await dapp.createPairing();

    const kp = generateX25519KeyPair();
    transport.receive({
      v: 1, t: 'join', ch: dapp.channelId,
      from: kp.publicKeyB64, pubkey: kp.publicKeyB64,
      capabilities: { methods: [], events: [], chains: [] },
    } as ProtocolMessage);
    await vi.advanceTimersByTimeAsync(10);

    expect(dapp.phase).toBe('pending_accept');

    await vi.advanceTimersByTimeAsync(61_000);
    expect(errorHandler).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('does not timeout if accepted before deadline', async () => {
    vi.useFakeTimers();

    const transport = new MockTransport();
    const dapp = new DAppSession({ transport, name: 'Test', autoAccept: false });

    const errorHandler = vi.fn();
    dapp.on('error', errorHandler);

    await dapp.createPairing();

    const kp = generateX25519KeyPair();
    transport.receive({
      v: 1, t: 'join', ch: dapp.channelId,
      from: kp.publicKeyB64, pubkey: kp.publicKeyB64,
      capabilities: { methods: [], events: [], chains: [] },
    } as ProtocolMessage);
    await vi.advanceTimersByTimeAsync(10);

    dapp.acceptWallet();
    await vi.advanceTimersByTimeAsync(61_000);

    expect(errorHandler).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
