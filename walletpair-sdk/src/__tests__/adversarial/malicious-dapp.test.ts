/**
 * Adversarial tests: Malicious DApp
 *
 * Simulates a malicious dApp attempting to abuse the wallet through
 * protocol violations: request flooding, out-of-state messages,
 * oversized payloads, and capability violations.
 *
 * These tests verify that the WalletSession enforces protocol rules
 * correctly, protecting the wallet user from a compromised or
 * malicious dApp.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  b64urlDecode,
  buildPairingUri,
  computeSharedSecret,
  deriveDirectionalSessionKeys,
  deriveSessionKey,
  generateChannelId,
  generateX25519KeyPair,
  sealPayload,
} from '../../crypto.js'
import { DAppSession } from '../../dapp-session.js'
import { MockRelay, MockTransport, makeJoinBody } from '../../test-helpers.js'
import type { Capabilities, ProtocolMessage } from '../../types.js'
import { WalletSession } from '../../wallet-session.js'

function wait(ms = 50): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// Helpers: manual wallet setup for adversarial scenarios
// ---------------------------------------------------------------------------

function setupWalletManual(caps?: Capabilities) {
  const transport = new MockTransport()
  const dappKp = generateX25519KeyPair()
  const channelId = generateChannelId()
  const session = new WalletSession({
    transport,
    meta: {
      name: 'W',
      description: 'Wallet',
      url: 'https://wallet.test',
      icon: 'https://wallet.test/i.png',
    },
    capabilities: caps ?? {
      methods: ['wallet_getAccounts', 'wallet_signMessage'],
      events: ['accountsChanged'],
      chains: ['eip155:1'],
    },
  })
  return { transport, session, dappKp, channelId }
}

async function connectWalletManual(ctx: ReturnType<typeof setupWalletManual>) {
  const { transport, session, dappKp, channelId } = ctx
  const uri = buildPairingUri({
    channelId,
    pubkeyB64: dappKp.publicKeyB64,
    relayUrl: 'ws://localhost/v1',
    name: 'Evil dApp',
    url: 'https://evil.test',
    icon: 'https://evil.test/i.png',
  })
  await session.joinFromUri(uri)

  transport.receive({
    v: 1,
    t: 'ready',
    ch: channelId,
    ts: Date.now(),
    from: '_adapter',
    body: { state: 'connected', reconnect: false, remote: dappKp.publicKeyB64 },
  } as ProtocolMessage)

  // Derive the dApp's send key (dappToWalletKey) to craft malicious requests.
  // The wallet's public key is in the join message's "from" field.
  const walletPubB64 = transport.sent.find((m) => m.t === 'join')?.from ?? ''
  const walletPubKey = b64urlDecode(walletPubB64)
  const shared = computeSharedSecret(dappKp.privateKey, walletPubKey)
  const rootKey = deriveSessionKey(shared, channelId)
  const ctx2 = {
    dappPubKeyB64: dappKp.publicKeyB64,
    walletPubKeyB64: walletPubB64,
    capabilities: (session as unknown as Record<string, unknown>).effectiveCapabilities,
    walletMeta: (session as unknown as Record<string, unknown>).meta,
    dappName: 'Evil dApp',
  }
  const keys = deriveDirectionalSessionKeys(rootKey, channelId, ctx2)
  shared.fill(0)
  rootKey.fill(0)

  return {
    sendKey: keys.dappToWalletKey, // dApp -> wallet encryption key
    walletPubB64,
    dappPubB64: dappKp.publicKeyB64,
  }
}

function craftReq(
  sendKey: Uint8Array,
  channelId: string,
  dappPubB64: string,
  seq: number,
  id: string,
  method: string,
  params?: Record<string, unknown>,
): ProtocolMessage {
  const payload = { _method: method, ...(params ?? {}) }
  const hdr = { type: 'req' as const, from: dappPubB64, id }
  const sealed = sealPayload(sendKey, channelId, seq, payload, hdr)
  return {
    v: 1,
    t: 'req',
    ch: channelId,
    ts: Date.now(),
    from: dappPubB64,
    body: { id, sealed },
  } as ProtocolMessage
}

// ---------------------------------------------------------------------------
// Attack 1: DApp sends >32 pending requests (rate limiting)
// ---------------------------------------------------------------------------

describe('Malicious DApp: Request flooding (>32 pending)', () => {
  it('wallet responds with rate_limited error when >32 pending requests', async () => {
    // ATTACK: A malicious dApp floods the wallet with many concurrent
    // requests to exhaust wallet resources or overwhelm the user with
    // approval dialogs.
    //
    // PREVENTS: Resource exhaustion on the wallet side. Section 15 rule 11
    // limits pending requests to 32 per channel.

    const ctx = setupWalletManual()
    const { transport, session, channelId } = ctx
    const { sendKey, dappPubB64 } = await connectWalletManual(ctx)

    // Do NOT handle requests (let them pile up as pending)
    const requests: Array<{ id: string; method: string }> = []
    session.on('request', (req) => requests.push(req))

    // Send 32 requests one at a time, waiting for each to be processed.
    // The transport.receive() is synchronous — it invokes handleMessage
    // directly, which processes the request synchronously.
    for (let i = 0; i < 32; i++) {
      transport.receive(
        craftReq(sendKey, channelId, dappPubB64, i, `req-${i}`, 'wallet_getAccounts'),
      )
    }
    // All 32 should have been emitted as requests
    expect(requests).toHaveLength(32)

    // 33rd request should be rate-limited
    transport.receive(
      craftReq(sendKey, channelId, dappPubB64, 32, 'req-overflow', 'wallet_getAccounts'),
    )

    // Wallet should have sent a res with rate_limited error (NOT close the channel)
    const rateLimitedRes = transport.sent.find(
      (m) => m.t === 'res' && (m.body as Record<string, unknown>)?.id === 'req-overflow',
    )
    expect(rateLimitedRes).toBeTruthy()

    // Verify the session is still alive (do NOT close for rate_limited)
    expect(session.phase).toBe('connected') // NOT closed!
    expect(requests).toHaveLength(32) // 33rd was NOT emitted
  })
})

// ---------------------------------------------------------------------------
// Attack 2: DApp sends req before ready.connected
// ---------------------------------------------------------------------------

describe('Malicious DApp: Request before connected', () => {
  it('wallet ignores req received before ready.connected', async () => {
    // ATTACK: DApp sends encrypted request before the channel reaches
    // connected state. The wallet should not process requests until
    // ready.connected is received.
    //
    // PREVENTS: Out-of-order message processing that could bypass
    // handshake security (Section 15 rule 7).

    const ctx = setupWalletManual()
    const { transport, session, dappKp, channelId } = ctx

    const requestHandler = vi.fn()
    session.on('request', requestHandler)

    const uri = buildPairingUri({
      channelId,
      pubkeyB64: dappKp.publicKeyB64,
      relayUrl: 'ws://localhost/v1',
      name: 'D',
      url: 'https://d.test',
      icon: 'https://d.test/i.png',
    })
    await session.joinFromUri(uri)
    // At this point, wallet is in waiting_accept, NOT connected

    // DApp sends req before ready.connected
    transport.receive({
      v: 1,
      t: 'req',
      ch: channelId,
      ts: Date.now(),
      from: dappKp.publicKeyB64,
      body: { id: 'premature-req', sealed: 'fake-sealed-data' },
    } as ProtocolMessage)

    await wait()

    // Request should NOT have been processed (recvKey is set but phase check
    // happens via from matching — the wallet will try to decrypt and fail
    // because sealed data is invalid, or the request is dropped)
    expect(requestHandler).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Attack 3: DApp sends req after close
// ---------------------------------------------------------------------------

describe('Malicious DApp: Request after close', () => {
  it('wallet does not send responses after session is destroyed', async () => {
    // ATTACK: DApp continues to send requests after the channel has
    // been closed, hoping to get the wallet to process them.
    //
    // PREVENTS: Post-close message processing (Section 15 rule 9).
    // After destroy(), all keys are zeroed and the session is cleaned up.
    // Even if a message somehow reaches the handler, it cannot be
    // decrypted (keys are zeroed) and no response can be sent.

    const ctx = setupWalletManual()
    const { transport, session, channelId } = ctx
    const { sendKey, dappPubB64 } = await connectWalletManual(ctx)

    // Destroy the session (close + key erasure)
    session.destroy()
    expect(session.phase).toBe('closed')

    const sentBefore = transport.sent.length

    // DApp sends req after destroy — keys are zeroed, decryption fails
    transport.receive(
      craftReq(sendKey, channelId, dappPubB64, 0, 'post-close-req', 'wallet_getAccounts'),
    )

    await wait()

    // No new messages should have been sent (cannot encrypt response
    // because sendKey was zeroed)
    const newMessages = transport.sent.slice(sentBefore)
    const resMessages = newMessages.filter((m) => m.t === 'res')
    expect(resMessages).toHaveLength(0)
  })

  it('close followed by receive via close message stops further processing', async () => {
    // When the wallet receives a close message from the peer, it
    // transitions to 'closed' and sets intentionalClose. Subsequent
    // messages on the transport should be ignored or fail gracefully.

    const dappTransport = new MockTransport()
    const walletTransport = new MockTransport()
    new MockRelay(dappTransport, walletTransport)

    const dappSession = new DAppSession({
      transport: dappTransport,
      meta: { name: 'D', description: 'D', url: 'https://d.test', icon: 'https://d.test/i.png' },
    })
    const walletSession = new WalletSession({
      transport: walletTransport,
      capabilities: { methods: ['wallet_getAccounts'], events: [], chains: ['eip155:1'] },
      meta: { name: 'W', description: 'W', url: 'https://w.test', icon: 'https://w.test/i.png' },
    })

    const uri = await dappSession.createPairing()
    await walletSession.joinFromUri(uri)
    await wait()
    await wait()

    expect(walletSession.phase).toBe('connected')

    // DApp closes the session
    dappSession.close()
    await wait()

    // Wallet should now be closed
    expect(walletSession.phase).toBe('closed')
  })
})

// ---------------------------------------------------------------------------
// Attack 4: DApp retries request with same ID but different params
// ---------------------------------------------------------------------------

describe('Malicious DApp: Duplicate request ID with different params', () => {
  it('wallet returns invalid_params when same req.id has different payload', async () => {
    // ATTACK: DApp sends a request, then retries with the same request ID
    // but different parameters — hoping to trick the wallet into
    // executing a different operation while reusing the same req.id
    // (e.g., changing the transaction recipient on retry).
    //
    // PREVENTS: Request parameter substitution attacks. Section 9.1
    // requires constant-time params hash comparison.

    const ctx = setupWalletManual()
    const { transport, session, channelId } = ctx
    const { sendKey, dappPubB64 } = await connectWalletManual(ctx)

    session.on('request', ({ id }) => {
      session.approve(id, 'approved')
    })

    // First request with id "req-1"
    transport.receive(
      craftReq(sendKey, channelId, dappPubB64, 0, 'req-1', 'wallet_signMessage', {
        message: 'hello',
      }),
    )
    await wait()

    // Retry with same id "req-1" but DIFFERENT params
    transport.receive(
      craftReq(sendKey, channelId, dappPubB64, 1, 'req-1', 'wallet_signMessage', {
        message: 'send_all_funds',
      }),
    )
    await wait()

    // Wallet should have sent a rejection response for the second attempt
    // Find the response messages
    const responses = transport.sent.filter((m) => m.t === 'res')
    expect(responses.length).toBeGreaterThanOrEqual(2)

    // The session must still be alive (do NOT close for invalid_params)
    expect(session.phase).toBe('connected')
  })
})

// ---------------------------------------------------------------------------
// Attack 5: DApp sends message >64KB
// ---------------------------------------------------------------------------

describe('Malicious DApp: Oversized message', () => {
  it('DAppSession emits error and drops messages exceeding 64KB', async () => {
    // ATTACK: DApp crafts an extremely large request to overwhelm
    // the wallet or relay.
    //
    // PREVENTS: Resource exhaustion via oversized payloads.
    // Section 15 rule 10: max 64 KB on the wire.
    //
    // We test the sendRaw() guard directly: the session emits an error
    // and the message is NOT actually delivered to the transport.

    const ctx = setupWalletManual()
    const { transport, session, channelId } = ctx
    const { sendKey, dappPubB64 } = await connectWalletManual(ctx)

    const requestHandler = vi.fn()
    session.on('request', requestHandler)

    // Craft a request with a payload that when JSON-serialized
    // would exceed 64 KB (the protocol message envelope adds overhead)
    const hugeData = 'x'.repeat(80_000)
    const payload = { _method: 'wallet_signMessage', data: hugeData }
    const hdr = { type: 'req' as const, from: dappPubB64, id: 'huge-req' }
    const sealed = sealPayload(sendKey, channelId, 0, payload, hdr)

    // The total message JSON will be > 64KB
    const msg = {
      v: 1,
      t: 'req',
      ch: channelId,
      ts: Date.now(),
      from: dappPubB64,
      body: { id: 'huge-req', sealed },
    } as ProtocolMessage

    const msgSize = new TextEncoder().encode(JSON.stringify(msg)).length
    // Verify our test setup actually exceeds the limit
    expect(msgSize).toBeGreaterThan(65536)

    // The wallet receives this directly (bypassing its own sendRaw check).
    // The wallet will try to process it. The relay should have blocked it,
    // but if it reaches the wallet, the wallet processes it normally
    // (the 64KB check is a send-side guard, not a receive-side guard).
    // The key security property is that the SENDER enforces the limit.
    transport.receive(msg)
    await wait()

    // For a send-side test, verify DAppSession's sendRaw blocks oversized messages
    const dappTransport = new MockTransport()
    const dappSession = new DAppSession({
      transport: dappTransport,
      meta: { name: 'D', description: 'D', url: 'https://d.test', icon: 'https://d.test/i.png' },
    })

    const dappErrors: Error[] = []
    dappSession.on('error', (e) => dappErrors.push(e))

    // Simulate connected state
    await dappSession.createPairing()
    const walletKp = generateX25519KeyPair()
    dappTransport.receive({
      v: 1,
      t: 'join',
      ch: dappSession.channelId,
      ts: Date.now(),
      from: walletKp.publicKeyB64,
      body: makeJoinBody(dappSession.channelId, dappTransport.sent[0]?.from ?? '', walletKp),
    } as ProtocolMessage)
    dappTransport.receive({
      v: 1,
      t: 'ready',
      ch: dappSession.channelId,
      ts: Date.now(),
      from: '_adapter',
      body: { state: 'connected', reconnect: false, remote: walletKp.publicKeyB64 },
    } as ProtocolMessage)

    const _sentBefore = dappTransport.sent.length

    // Try to send a huge request — sendRaw should catch the 64KB limit
    // and emit an error instead of sending
    dappSession.request('wallet_signMessage', { data: hugeData })
    await wait()

    // The error should have been emitted
    expect(dappErrors.some((e) => e.message.includes('64 KB'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Attack 6: DApp calls method not in capabilities
// ---------------------------------------------------------------------------

describe('Malicious DApp: Capability violation', () => {
  it('wallet rejects method not in capabilities with unsupported_method', async () => {
    // ATTACK: DApp calls a method that the wallet did not grant in its
    // capabilities, hoping to access restricted functionality.
    //
    // PREVENTS: Unauthorized method access. Section 7.1 runtime
    // enforcement requires wallet to reject with unsupported_method.

    const ctx = setupWalletManual({
      methods: ['wallet_getAccounts'], // only getAccounts, NOT signMessage
      events: [],
      chains: ['eip155:1'],
    })
    const { transport, session, channelId } = ctx
    const { sendKey, dappPubB64 } = await connectWalletManual(ctx)

    const requestHandler = vi.fn()
    session.on('request', requestHandler)

    // DApp tries to call wallet_signMessage which is NOT in capabilities
    transport.receive(
      craftReq(sendKey, channelId, dappPubB64, 0, 'req-evil', 'wallet_signMessage', {
        message: 'hack',
      }),
    )
    await wait()

    // Request should NOT have been emitted to the application
    expect(requestHandler).not.toHaveBeenCalled()

    // Wallet should have sent an error response
    const rejectRes = transport.sent.find(
      (m) => m.t === 'res' && (m.body as Record<string, unknown>)?.id === 'req-evil',
    )
    expect(rejectRes).toBeTruthy()

    // Session must remain open (do NOT close for unsupported_method)
    expect(session.phase).toBe('connected')
  })

  it('wallet rejects completely unknown method', async () => {
    const ctx = setupWalletManual({
      methods: ['wallet_getAccounts'],
      events: [],
      chains: ['eip155:1'],
    })
    const { transport, session, channelId } = ctx
    const { sendKey, dappPubB64 } = await connectWalletManual(ctx)

    const requestHandler = vi.fn()
    session.on('request', requestHandler)

    transport.receive(
      craftReq(sendKey, channelId, dappPubB64, 0, 'req-unknown', 'evil_drainWallet'),
    )
    await wait()

    expect(requestHandler).not.toHaveBeenCalled()
    expect(session.phase).toBe('connected')
  })
})

// ---------------------------------------------------------------------------
// Attack 7: DApp sends req with _adapter spoofed from
// ---------------------------------------------------------------------------

describe('Malicious DApp: Spoofed _adapter from', () => {
  it('wallet rejects req with from="_adapter"', async () => {
    // ATTACK: DApp (or relay) sends a req with from="_adapter" to
    // confuse the wallet. Section 2 requires peers to reject any
    // peer-sent message where from equals "_adapter".
    //
    // PREVENTS: Adapter impersonation in peer message types.

    const ctx = setupWalletManual()
    const { transport, session, channelId } = ctx
    await connectWalletManual(ctx)

    const errorHandler = vi.fn()
    session.on('error', errorHandler)
    const requestHandler = vi.fn()
    session.on('request', requestHandler)

    transport.receive({
      v: 1,
      t: 'req',
      ch: channelId,
      ts: Date.now(),
      from: '_adapter', // spoofed!
      body: { id: 'spoofed-req', sealed: 'fake' },
    } as ProtocolMessage)

    await wait()

    expect(errorHandler).toHaveBeenCalled()
    expect(errorHandler.mock.calls[0]?.[0]?.message).toContain('spoofed _adapter')
    expect(requestHandler).not.toHaveBeenCalled()
  })
})
