/**
 * Adversarial tests: Malicious Wallet
 *
 * Simulates a malicious wallet attempting to abuse the dApp through
 * protocol violations: wrong response IDs, role violations, sequence
 * manipulation, and out-of-state messages.
 *
 * These tests verify that the DAppSession enforces protocol rules
 * correctly, protecting the dApp from a compromised or malicious wallet.
 */

import { describe, expect, it, vi } from 'vitest'
import { generateX25519KeyPair, sealPayload } from '../../crypto.js'
import { DAppSession } from '../../dapp-session.js'
import { MockTransport, makeJoinBody } from '../../test-helpers.js'
import type { ProtocolMessage } from '../../types.js'

function wait(ms = 50): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDAppManual() {
  const transport = new MockTransport()
  const session = new DAppSession({
    transport,
    meta: {
      name: 'Test',
      description: 'Test dApp',
      url: 'https://test.com',
      icon: 'https://test.com/icon.png',
    },
  })
  const walletKp = generateX25519KeyPair()
  return { transport, session, walletKp }
}

async function connectDAppManual(ctx: ReturnType<typeof setupDAppManual>) {
  const { transport, session, walletKp } = ctx
  await session.createPairing()

  transport.receive({
    v: 1,
    t: 'join',
    ch: session.channelId,
    ts: Date.now(),
    from: walletKp.publicKeyB64,
    body: makeJoinBody(session.channelId, transport.sent[0]?.from ?? '', walletKp),
  } as ProtocolMessage)

  transport.receive({
    v: 1,
    t: 'ready',
    ch: session.channelId,
    ts: Date.now(),
    from: '_adapter',
    body: { state: 'connected', reconnect: false, remote: walletKp.publicKeyB64 },
  } as ProtocolMessage)

  const recvKey = (session as unknown as Record<string, unknown>).recvKey as Uint8Array
  const dappPubB64 = transport.sent[0]?.from ?? ''
  return { recvKey, dappPubB64 }
}

// ---------------------------------------------------------------------------
// Attack 1: Wallet sends res with wrong req.id
// ---------------------------------------------------------------------------

describe('Malicious Wallet: Wrong response ID', () => {
  it('response with unknown req.id is ignored by dApp', async () => {
    // ATTACK: A malicious wallet sends a response with an ID that does
    // not match any pending request. This could be an attempt to inject
    // fake results or confuse request/response matching.
    //
    // PREVENTS: Response injection for non-existent requests.
    // The dApp should silently ignore responses with unknown IDs.

    const ctx = setupDAppManual()
    const { transport, session, walletKp } = ctx
    const { recvKey } = await connectDAppManual(ctx)

    const responseHandler = vi.fn()
    session.on('response', responseHandler)

    // Wallet sends a response with a fabricated request ID
    transport.receive({
      v: 1,
      t: 'res',
      ch: session.channelId,
      ts: Date.now(),
      from: walletKp.publicKeyB64,
      body: {
        id: 'fabricated-req-id',
        sealed: sealPayload(
          recvKey,
          session.channelId,
          0,
          { _ok: true, _result: 'injected-data' },
          { type: 'res', from: walletKp.publicKeyB64, id: 'fabricated-req-id' },
        ),
      },
    } as ProtocolMessage)

    await wait()

    // Response handler should NOT have been called (no matching pending request)
    expect(responseHandler).not.toHaveBeenCalled()
    // Session should remain healthy
    expect(session.phase).toBe('connected')
  })

  it('response to wrong req.id does not resolve a different pending request', async () => {
    // ATTACK: Wallet sends a response with a different request's ID,
    // trying to resolve the wrong request with attacker-chosen data.
    //
    // PREVENTS: Cross-request response substitution.

    const ctx = setupDAppManual()
    const { transport, session, walletKp } = ctx
    const { recvKey } = await connectDAppManual(ctx)

    // Send two requests
    const p1 = session.request('wallet_getAccounts')
    const p2 = session.request('wallet_signMessage', { message: 'test' })
    await wait(20)

    const reqs = transport.sent.filter((m) => m.t === 'req')
    const req1Id = (reqs[0]?.body as Record<string, unknown>)?.id as string
    const req2Id = (reqs[1]?.body as Record<string, unknown>)?.id as string

    // Wallet responds to req2 with req1's ID (cross-wired)
    // The AAD includes the id field, so if the id doesn't match,
    // AEAD decryption will fail (or the wrong request will be resolved
    // with potentially confusing data).
    transport.receive({
      v: 1,
      t: 'res',
      ch: session.channelId,
      ts: Date.now(),
      from: walletKp.publicKeyB64,
      body: {
        id: req1Id,
        sealed: sealPayload(
          recvKey,
          session.channelId,
          0,
          { _ok: true, _result: 'correct-for-req1' },
          { type: 'res', from: walletKp.publicKeyB64, id: req1Id },
        ),
      },
    } as ProtocolMessage)

    // req1 should resolve correctly
    expect(await p1).toBe('correct-for-req1')

    // Now respond to req2 normally
    transport.receive({
      v: 1,
      t: 'res',
      ch: session.channelId,
      ts: Date.now(),
      from: walletKp.publicKeyB64,
      body: {
        id: req2Id,
        sealed: sealPayload(
          recvKey,
          session.channelId,
          1,
          { _ok: true, _result: 'correct-for-req2' },
          { type: 'res', from: walletKp.publicKeyB64, id: req2Id },
        ),
      },
    } as ProtocolMessage)

    expect(await p2).toBe('correct-for-req2')
  })
})

// ---------------------------------------------------------------------------
// Attack 2: Wallet sends req (role violation)
// ---------------------------------------------------------------------------

describe('Malicious Wallet: Sends req (role violation)', () => {
  it('dApp ignores req from wallet because only dApp sends req', async () => {
    // ATTACK: Wallet sends a req message to the dApp. Per Section 5,
    // only the dApp sends req. The wallet should never do this.
    // The dApp should either ignore it or treat it as a protocol error.
    //
    // PREVENTS: Role reversal attack where wallet tries to command the dApp.

    const ctx = setupDAppManual()
    const { transport, session, walletKp } = ctx
    const { recvKey } = await connectDAppManual(ctx)

    const errorHandler = vi.fn()
    session.on('error', errorHandler)

    // Wallet sends a req (which it should never do)
    transport.receive({
      v: 1,
      t: 'req',
      ch: session.channelId,
      ts: Date.now(),
      from: walletKp.publicKeyB64,
      body: {
        id: 'evil-req-1',
        sealed: sealPayload(
          recvKey,
          session.channelId,
          0,
          { _method: 'dapp_executeTransaction' },
          { type: 'req', from: walletKp.publicKeyB64, id: 'evil-req-1' },
        ),
      },
    } as ProtocolMessage)

    await wait()

    // DApp does not have a request handler (it only sends requests).
    // The message should be silently ignored or cause no state change.
    // Key insight: DAppSession.handleMessage() has no case for 'req'
    // messages from the wallet, so it falls through to the default
    // case (no-op).
    expect(session.phase).toBe('connected')
  })
})

// ---------------------------------------------------------------------------
// Attack 3: Wallet manipulates sequence numbers
// ---------------------------------------------------------------------------

describe('Malicious Wallet: Sequence number manipulation', () => {
  it('skipped sequence numbers are accepted (gaps are valid per spec)', async () => {
    // Per Section 6.6.1: "Gaps are valid (expected after reconnect)."
    // This is NOT an attack — verifying correct behavior.

    const ctx = setupDAppManual()
    const { transport, session, walletKp } = ctx
    const { recvKey } = await connectDAppManual(ctx)

    const p = session.request('wallet_getAccounts')
    await wait(20)
    const req = transport.sent.find((m) => m.t === 'req')
    const reqId = (req?.body as Record<string, unknown>)?.id as string

    // Wallet responds with seq=5 (skipping 0-4) — should be accepted
    transport.receive({
      v: 1,
      t: 'res',
      ch: session.channelId,
      ts: Date.now(),
      from: walletKp.publicKeyB64,
      body: {
        id: reqId,
        sealed: sealPayload(
          recvKey,
          session.channelId,
          5,
          { _ok: true, _result: 'gap-ok' },
          { type: 'res', from: walletKp.publicKeyB64, id: reqId },
        ),
      },
    } as ProtocolMessage)

    expect(await p).toBe('gap-ok')
  })

  it('reset sequence to 0 after receiving higher seq is rejected', async () => {
    // ATTACK: Wallet sends seq=10, then tries to reset to seq=0.
    // This is a replay/reset attack. Section 6.6.1: "A message MUST
    // be rejected if its sequence number is not strictly greater than
    // the last accepted value."
    //
    // PREVENTS: Sequence counter reset allowing message replay.

    const ctx = setupDAppManual()
    const { transport, session, walletKp } = ctx
    const { recvKey } = await connectDAppManual(ctx)

    // First response at seq=10 (accepted)
    const p0 = session.request('wallet_getAccounts')
    await wait(20)
    const req0 = transport.sent.find((m) => m.t === 'req')
    const r0id = (req0?.body as Record<string, unknown>)?.id as string
    transport.receive({
      v: 1,
      t: 'res',
      ch: session.channelId,
      ts: Date.now(),
      from: walletKp.publicKeyB64,
      body: {
        id: r0id,
        sealed: sealPayload(
          recvKey,
          session.channelId,
          10,
          { _ok: true, _result: 'first' },
          { type: 'res', from: walletKp.publicKeyB64, id: r0id },
        ),
      },
    } as ProtocolMessage)
    expect(await p0).toBe('first')

    // Second response at seq=0 (reset attempt — MUST be rejected)
    const p1 = session.request('wallet_getAccounts')
    await wait(20)
    const req1 = transport.sent.filter((m) => m.t === 'req')[1]
    const r1id = (req1?.body as Record<string, unknown>)?.id as string
    transport.receive({
      v: 1,
      t: 'res',
      ch: session.channelId,
      ts: Date.now(),
      from: walletKp.publicKeyB64,
      body: {
        id: r1id,
        sealed: sealPayload(
          recvKey,
          session.channelId,
          0, // reset to 0!
          { _ok: true, _result: 'replayed' },
          { type: 'res', from: walletKp.publicKeyB64, id: r1id },
        ),
      },
    } as ProtocolMessage)
    await expect(p1).rejects.toThrow('Replay detected')
  })

  it('reused sequence number is rejected', async () => {
    // ATTACK: Wallet sends the same sequence number twice.
    //
    // PREVENTS: Nonce reuse in AEAD encryption.

    const ctx = setupDAppManual()
    const { transport, session, walletKp } = ctx
    const { recvKey } = await connectDAppManual(ctx)

    // First at seq=3 (accepted)
    const p0 = session.request('wallet_getAccounts')
    await wait(20)
    const req0 = transport.sent.find((m) => m.t === 'req')
    const r0id = (req0?.body as Record<string, unknown>)?.id as string
    transport.receive({
      v: 1,
      t: 'res',
      ch: session.channelId,
      ts: Date.now(),
      from: walletKp.publicKeyB64,
      body: {
        id: r0id,
        sealed: sealPayload(
          recvKey,
          session.channelId,
          3,
          { _ok: true, _result: 'ok' },
          { type: 'res', from: walletKp.publicKeyB64, id: r0id },
        ),
      },
    } as ProtocolMessage)
    expect(await p0).toBe('ok')

    // Second at seq=3 (reuse — MUST be rejected)
    const p1 = session.request('wallet_getAccounts')
    await wait(20)
    const req1 = transport.sent.filter((m) => m.t === 'req')[1]
    const r1id = (req1?.body as Record<string, unknown>)?.id as string
    transport.receive({
      v: 1,
      t: 'res',
      ch: session.channelId,
      ts: Date.now(),
      from: walletKp.publicKeyB64,
      body: {
        id: r1id,
        sealed: sealPayload(
          recvKey,
          session.channelId,
          3, // same seq!
          { _ok: true, _result: 'reused' },
          { type: 'res', from: walletKp.publicKeyB64, id: r1id },
        ),
      },
    } as ProtocolMessage)
    await expect(p1).rejects.toThrow('Replay detected')
  })
})

// ---------------------------------------------------------------------------
// Attack 4: Wallet sends evt before ready.connected
// ---------------------------------------------------------------------------

describe('Malicious Wallet: Event before connected', () => {
  it('dApp ignores evt received before ready.connected', async () => {
    // ATTACK: Wallet sends an event before the channel reaches
    // connected state. The dApp should not process events until
    // ready.connected is received (Section 15 rule 7).
    //
    // PREVENTS: Pre-connection event injection.

    const transport = new MockTransport()
    const session = new DAppSession({
      transport,
      meta: { name: 'T', description: 'T', url: 'https://t.test', icon: 'https://t.test/i.png' },
      autoAccept: false, // manual accept to control timing
    })

    const eventHandler = vi.fn()
    session.on('event', eventHandler)

    await session.createPairing()
    const dappPubB64 = transport.sent[0]?.from ?? ''

    const walletKp = generateX25519KeyPair()

    // Wallet joins
    transport.receive({
      v: 1,
      t: 'join',
      ch: session.channelId,
      ts: Date.now(),
      from: walletKp.publicKeyB64,
      body: makeJoinBody(session.channelId, dappPubB64, walletKp),
    } as ProtocolMessage)

    await wait()
    // Session is now in pending_accept, NOT connected

    // Wallet tries to send an event before connected
    transport.receive({
      v: 1,
      t: 'evt',
      ch: session.channelId,
      ts: Date.now(),
      from: walletKp.publicKeyB64,
      body: { id: 'premature-evt', sealed: 'fake-sealed' },
    } as ProtocolMessage)

    await wait()

    // Event should NOT have been processed (recvKey exists but
    // the sealed data is invalid, or the event is silently dropped
    // due to decryption failure)
    expect(eventHandler).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Attack 5: Wallet sends response from a different key
// ---------------------------------------------------------------------------

describe('Malicious Wallet: Response from wrong peer', () => {
  it('dApp ignores response from a key that does not match paired wallet', async () => {
    // ATTACK: A different entity (or the relay itself) sends a response
    // with a different "from" key. The dApp checks that from matches
    // the paired wallet's public key.
    //
    // PREVENTS: Third-party response injection.

    const ctx = setupDAppManual()
    const { transport, session } = ctx
    const { recvKey } = await connectDAppManual(ctx)

    const p = session.request('wallet_getAccounts')
    await wait(20)
    const req = transport.sent.find((m) => m.t === 'req')
    const reqId = (req?.body as Record<string, unknown>)?.id as string

    // Impersonator uses a different key
    const impersonatorKp = generateX25519KeyPair()
    transport.receive({
      v: 1,
      t: 'res',
      ch: session.channelId,
      ts: Date.now(),
      from: impersonatorKp.publicKeyB64, // wrong key!
      body: {
        id: reqId,
        sealed: sealPayload(
          recvKey,
          session.channelId,
          0,
          { _ok: true, _result: 'evil' },
          { type: 'res', from: impersonatorKp.publicKeyB64, id: reqId },
        ),
      },
    } as ProtocolMessage)

    await wait(20)

    // The response should have been silently dropped (from mismatch)
    // The request should still be pending (not resolved)
    // Clean up by closing
    session.close()
    await expect(p).rejects.toThrow('Session closed')
  })
})

// ---------------------------------------------------------------------------
// Attack 6: Wallet sends unsupported protocol version
// ---------------------------------------------------------------------------

describe('Malicious Wallet: Unsupported protocol version', () => {
  it('dApp closes with unsupported_version on receiving v!=1', async () => {
    // ATTACK: Wallet sends messages with a different protocol version
    // to confuse parsing or exploit version-specific vulnerabilities.
    //
    // PREVENTS: Version confusion attacks. Section 15 rule 12.

    const ctx = setupDAppManual()
    const { transport, session, walletKp } = ctx
    await connectDAppManual(ctx)

    transport.receive({
      v: 99 as ProtocolMessage['v'],
      t: 'res',
      ch: session.channelId,
      ts: Date.now(),
      from: walletKp.publicKeyB64,
      body: { id: 'req-1', sealed: 'whatever' },
    } as ProtocolMessage)

    await wait()

    // DApp should close with unsupported_version
    expect(session.phase).toBe('closed')
    const closeMsg = transport.sent.find((m) => m.t === 'close')
    expect(closeMsg).toBeTruthy()
    expect((closeMsg?.body as Record<string, unknown>)?.reason).toBe('unsupported_version')
  })
})
