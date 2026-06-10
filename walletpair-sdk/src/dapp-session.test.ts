import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AadHeader } from './crypto.js'
import {
  b64urlDecode,
  computeSessionFingerprint,
  computeSharedSecret,
  deriveSessionKey,
  generateX25519KeyPair,
  parsePairingUri,
  sealPayload,
  unsealPayload,
} from './crypto.js'
import { DAppSession } from './dapp-session.js'
import { clearDisconnectLog, getDisconnectLog } from './disconnect-log.js'
import { MockTransport, makeJoinBody } from './test-helpers.js'
import type { ProtocolMessage } from './types.js'

function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setTimeout(r, 10))
}

function dappPubKeyFromCreate(transport: MockTransport): string {
  return transport.sent.find((m) => m.t === 'create')?.from!
}

function receiveFreshJoin(
  transport: MockTransport,
  session: DAppSession,
  walletKp: ReturnType<typeof generateX25519KeyPair>,
): void {
  transport.receive({
    v: 1,
    t: 'join',
    ch: session.channelId,
    ts: Date.now(),
    from: walletKp.publicKeyB64,
    body: makeJoinBody(session.channelId, dappPubKeyFromCreate(transport), walletKp),
  } as ProtocolMessage)
}

function receiveConnected(
  transport: MockTransport,
  session: DAppSession,
  walletPubKeyB64: string,
): void {
  transport.receive({
    v: 1,
    t: 'ready',
    ch: session.channelId,
    ts: Date.now(),
    from: '_adapter',
    body: { state: 'connected', reconnect: false, remote: walletPubKeyB64 },
  } as ProtocolMessage)
}

describe('DAppSession', () => {
  let transport: MockTransport
  let session: DAppSession

  beforeEach(() => {
    transport = new MockTransport()
    session = new DAppSession({
      transport,
      meta: {
        name: 'Test dApp',
        description: 'Test',
        url: 'https://test.com',
        icon: 'https://test.com/icon.png',
      },
    })
  })

  describe('createPairing', () => {
    it('starts in idle phase', () => {
      expect(session.phase).toBe('idle')
    })

    it('creates pairing and transitions to waiting', async () => {
      const phases: string[] = []
      session.on('phase', (p) => phases.push(p))

      const uri = await session.createPairing()
      expect(uri).toContain('walletpair:?ch=')
      expect(uri).toContain('&pubkey=')
      expect(session.phase).toBe('waiting')
      expect(session.channelId).toHaveLength(64)
      expect(session.pairingUri).toBe(uri)
      expect(phases).toContain('waiting')
    })

    it('emits pairingUri event', async () => {
      const handler = vi.fn()
      session.on('pairingUri', handler)
      await session.createPairing()
      expect(handler).toHaveBeenCalledWith(session.pairingUri)
    })

    it('sends create message to transport', async () => {
      await session.createPairing()
      expect(transport.sent).toHaveLength(1)
      expect(transport.sent[0]?.t).toBe('create')
      expect(transport.sent[0]?.from).toBeTruthy()
    })

    it('pairing URI is parseable', async () => {
      await session.createPairing()
      const parsed = parsePairingUri(session.pairingUri)
      expect(parsed.ch).toBe(session.channelId)
    })
  })

  describe('wallet join handling', () => {
    let walletKp: ReturnType<typeof generateX25519KeyPair>

    beforeEach(async () => {
      await session.createPairing()
      walletKp = generateX25519KeyPair()
    })

    it('auto-accepts and transitions to accepting on join', async () => {
      const phases: string[] = []
      session.on('phase', (p) => phases.push(p))

      receiveFreshJoin(transport, session, walletKp)

      // With auto-accept, the session should not stay in pending_accept
      // It should proceed to accepting (waiting for ready.connected)
      expect(session.phase).not.toBe('idle')
    })

    it('computes and emits session fingerprint on createPairing', async () => {
      expect(session.sessionFingerprint).toMatch(/^\d{4}$/)
    })

    it('emits walletJoined with capabilities and meta from sealed_join', async () => {
      const handler = vi.fn()
      session.on('walletJoined', handler)

      receiveFreshJoin(transport, session, walletKp)

      expect(handler).toHaveBeenCalledWith({
        capabilities: expect.objectContaining({ methods: expect.any(Array) }),
        meta: expect.objectContaining({ name: 'Test Wallet' }),
      })
    })
  })

  describe('auto-accept on join', () => {
    it('auto-accepts and transitions to connected on ready', async () => {
      await session.createPairing()
      const walletKp = generateX25519KeyPair()

      receiveFreshJoin(transport, session, walletKp)

      // Should have auto-sent accept (no manual acceptWallet needed)
      const acceptMsg = transport.sent.find((m) => m.t === 'accept')
      expect(acceptMsg).toBeTruthy()
      expect((acceptMsg as any).body.target).toBe(walletKp.publicKeyB64)

      // Simulate relay responding with ready.connected
      receiveConnected(transport, session, walletKp.publicKeyB64)

      expect(session.phase).toBe('connected')
    })

    it('rejects ready.connected with missing remote', async () => {
      await session.createPairing()
      const walletKp = generateX25519KeyPair()
      const errorHandler = vi.fn()
      session.on('error', errorHandler)

      receiveFreshJoin(transport, session, walletKp)

      transport.receive({
        v: 1,
        t: 'ready',
        ch: session.channelId,
        ts: Date.now(),
        from: '_adapter',
        body: { state: 'connected', reconnect: false, remote: null },
      } as ProtocolMessage)

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('remote does not match'),
        }),
      )
      expect(session.phase).toBe('closed')
    })
  })

  describe('rejectWallet', () => {
    it('sends close with user_rejected and closes session (autoAccept disabled)', async () => {
      const manualSession = new DAppSession({
        transport,
        autoAccept: false,
        meta: {
          name: 'Test dApp',
          description: 'Test',
          url: 'https://test.com',
          icon: 'https://test.com/icon.png',
        },
      })
      await manualSession.createPairing()
      const walletKp = generateX25519KeyPair()

      receiveFreshJoin(transport, manualSession, walletKp)

      manualSession.rejectWallet()

      const closeMsg = transport.sent.find((m) => m.t === 'close')
      expect(closeMsg).toBeTruthy()
      expect((closeMsg as any).body.reason).toBe('user_rejected')
      expect(manualSession.phase).toBe('closed')
    })
  })

  describe('request/response', () => {
    let walletKp: ReturnType<typeof generateX25519KeyPair>
    let sessionKey: Uint8Array
    let walletToDappKey: Uint8Array

    beforeEach(async () => {
      await session.createPairing()
      walletKp = generateX25519KeyPair()

      // Simulate join
      receiveFreshJoin(transport, session, walletKp)

      // Derive session key from wallet side
      const dappPubB64 = transport.sent[0]?.from!
      const dappPub = b64urlDecode(dappPubB64)
      const shared = computeSharedSecret(walletKp.privateKey, dappPub)
      sessionKey = deriveSessionKey(shared, session.channelId)

      // Auto-accepted; simulate relay ready.connected
      receiveConnected(transport, session, walletKp.publicKeyB64)
      walletToDappKey = (session as any).recvKey
    })

    it('sends encrypted request', async () => {
      const promise = session.request('wallet_getAccounts')

      await flushMicrotasks()

      const reqMsg = transport.sent.find((m) => m.t === 'req')
      expect(reqMsg).toBeTruthy()
      const reqBody = (reqMsg as any).body
      expect(reqBody.id).toMatch(/^req-/)
      expect(reqBody.sealed).toBeTruthy()

      // Simulate wallet response
      const resData = { _ok: true, _result: ['0xabc123'] }
      const resHdr: AadHeader = { type: 'res', from: walletKp.publicKeyB64, id: reqBody.id }
      transport.receive({
        v: 1,
        t: 'res',
        ch: session.channelId,
        ts: Date.now(),
        from: walletKp.publicKeyB64,
        body: {
          id: reqBody.id,
          sealed: sealPayload(walletToDappKey, session.channelId, 0, resData, resHdr),
        },
      } as ProtocolMessage)

      const result = await promise
      expect(result).toEqual(['0xabc123'])
    })

    it('sends request with encrypted params', async () => {
      const promise = session.request('wallet_signMessage', { message: 'Hello' })
      await flushMicrotasks()

      const reqMsg = transport.sent.find((m) => m.t === 'req') as any
      expect(reqMsg.body.sealed).toBeTruthy() // params were sealed

      // Respond
      const reqId = reqMsg.body.id
      transport.receive({
        v: 1,
        t: 'res',
        ch: session.channelId,
        ts: Date.now(),
        from: walletKp.publicKeyB64,
        body: {
          id: reqId,
          sealed: sealPayload(
            walletToDappKey,
            session.channelId,
            0,
            { _ok: true, _result: { signature: '0x...' } },
            { type: 'res', from: walletKp.publicKeyB64, id: reqId },
          ),
        },
      } as ProtocolMessage)

      const result = await promise
      expect(result).toEqual({ signature: '0x...' })
    })

    it('rejects on error response', async () => {
      const promise = session.request('wallet_signMessage', { message: 'Hi' })
      await flushMicrotasks()

      const reqMsg = transport.sent.find((m) => m.t === 'req') as any
      const reqId = reqMsg.body.id

      transport.receive({
        v: 1,
        t: 'res',
        ch: session.channelId,
        ts: Date.now(),
        from: walletKp.publicKeyB64,
        body: {
          id: reqId,
          sealed: sealPayload(
            walletToDappKey,
            session.channelId,
            0,
            { _ok: false, code: 'user_rejected', message: 'User rejected' },
            { type: 'res', from: walletKp.publicKeyB64, id: reqId },
          ),
        },
      } as ProtocolMessage)

      await expect(promise).rejects.toThrow('User rejected')
    })

    it('rejects on timeout', async () => {
      vi.useFakeTimers()

      const shortTimeoutSession = new DAppSession({
        transport,
        meta: {
          name: 'Test',
          description: 'Test',
          url: 'https://test.com',
          icon: 'https://test.com/icon.png',
        },
        requestTimeout: 100,
      })
      // Manually set session state to connected
      ;(shortTimeoutSession as any).phase = 'connected'
      ;(shortTimeoutSession as any).sessionKey = sessionKey
      ;(shortTimeoutSession as any).sendKey = new Uint8Array(32).fill(1)
      ;(shortTimeoutSession as any).channelId = session.channelId
      ;(shortTimeoutSession as any).pubKeyB64 = 'test'

      const promise = shortTimeoutSession.request('wallet_getAccounts')
      vi.advanceTimersByTime(200)

      await expect(promise).rejects.toThrow('timed out')
      vi.useRealTimers()
    })

    it('emits response event', async () => {
      const handler = vi.fn()
      session.on('response', handler)

      const promise = session.request('wallet_getAccounts')
      await flushMicrotasks()

      const reqMsg = transport.sent.find((m) => m.t === 'req') as any
      const reqId = reqMsg.body.id
      transport.receive({
        v: 1,
        t: 'res',
        ch: session.channelId,
        ts: Date.now(),
        from: walletKp.publicKeyB64,
        body: {
          id: reqId,
          sealed: sealPayload(
            walletToDappKey,
            session.channelId,
            0,
            { _ok: true, _result: ['0x123'] },
            { type: 'res', from: walletKp.publicKeyB64, id: reqId },
          ),
        },
      } as ProtocolMessage)

      await promise
      expect(handler).toHaveBeenCalledWith({ id: reqId, ok: true, result: ['0x123'] })
    })

    it('rejects request when not connected', async () => {
      const idleSession = new DAppSession({
        transport: new MockTransport(),
        meta: {
          name: 'Test',
          description: 'Test',
          url: 'https://test.com',
          icon: 'https://test.com/icon.png',
        },
      })
      await expect(idleSession.request('test')).rejects.toThrow('Not connected')
    })
  })

  describe('event handling', () => {
    it('emits event when wallet pushes evt', async () => {
      await session.createPairing()
      const walletKp = generateX25519KeyPair()

      receiveFreshJoin(transport, session, walletKp)

      const dappPub = b64urlDecode(transport.sent[0]?.from!)
      const shared = computeSharedSecret(walletKp.privateKey, dappPub)
      deriveSessionKey(shared, session.channelId)

      receiveConnected(transport, session, walletKp.publicKeyB64)

      const handler = vi.fn()
      session.on('event', handler)

      const evtId = 'evt-1'
      transport.receive({
        v: 1,
        t: 'evt',
        ch: session.channelId,
        ts: Date.now(),
        from: walletKp.publicKeyB64,
        body: {
          id: evtId,
          sealed: sealPayload(
            (session as any).recvKey,
            session.channelId,
            0,
            { _event: 'accountsChanged', accounts: ['0xabc'] },
            { type: 'evt', from: walletKp.publicKeyB64, id: evtId },
          ),
        },
      } as ProtocolMessage)

      expect(handler).toHaveBeenCalledWith({
        event: 'accountsChanged',
        data: { accounts: ['0xabc'] },
      })
    })
  })

  describe('ping/pong', () => {
    it('responds to ping with pong', async () => {
      await session.createPairing()
      const walletPubB64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      ;(session as any).remotePubKey = b64urlDecode(walletPubB64)
      receiveConnected(transport, session, walletPubB64)

      transport.receive({
        v: 1,
        t: 'ping',
        ch: session.channelId,
        ts: 1000,
        from: walletPubB64,
        body: {},
      } as ProtocolMessage)

      const pong = transport.sent.find((m) => m.t === 'pong')
      expect(pong).toBeTruthy()
      expect(pong?.ts).toBeTypeOf('number')
    })

    it('sends ping', async () => {
      const walletPubB64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      await session.createPairing()
      ;(session as any).remotePubKey = b64urlDecode(walletPubB64)
      receiveConnected(transport, session, walletPubB64)

      session.ping()
      const ping = transport.sent.find((m) => m.t === 'ping')
      expect(ping).toBeTruthy()
    })
  })

  describe('close', () => {
    it('sends close message and transitions to closed', async () => {
      await session.createPairing()
      session.close()

      const closeMsg = transport.sent.find((m) => m.t === 'close')
      expect(closeMsg).toBeTruthy()
      expect((closeMsg as any).body.reason).toBe('normal')
      expect(session.phase).toBe('closed')
    })

    it('rejects all pending requests on close', async () => {
      await session.createPairing()
      const walletKp = generateX25519KeyPair()

      receiveFreshJoin(transport, session, walletKp)
      receiveConnected(transport, session, walletKp.publicKeyB64)

      const promise = session.request('test')
      session.close()

      await expect(promise).rejects.toThrow('Session closed')
    })
  })

  describe('serialize/restore', () => {
    it('round-trips session state', async () => {
      await session.createPairing()
      const walletKp = generateX25519KeyPair()

      receiveFreshJoin(transport, session, walletKp)

      const json = session.serialize()
      expect(json).toBeTruthy()

      const newTransport = new MockTransport()
      const restored = new DAppSession({
        transport: newTransport,
        meta: {
          name: 'Test dApp',
          description: 'Test',
          url: 'https://test.com',
          icon: 'https://test.com/icon.png',
        },
      })
      expect(restored.restore(json)).toBe(true)
      expect(restored.channelId).toBe(session.channelId)
    })

    it('returns false for invalid JSON', () => {
      const s = new DAppSession({
        transport: new MockTransport(),
        meta: {
          name: 'Test dApp',
          description: 'Test',
          url: 'https://test.com',
          icon: 'https://test.com/icon.png',
        },
      })
      expect(s.restore('not json')).toBe(false)
      expect(s.restore('{}')).toBe(false)
      expect(s.restore('{"channelId":"abc"}')).toBe(false) // missing privKey
    })
  })

  describe('auto-accept on rejoin', () => {
    it('auto-accepts known wallet on rejoin (no sealed_join on reconnect)', async () => {
      await session.createPairing()
      const walletKp = generateX25519KeyPair()

      // First join carries sealed capabilities/meta (auto-accepted).
      receiveFreshJoin(transport, session, walletKp)
      receiveConnected(transport, session, walletKp.publicKeyB64)

      // Second join (rejoin) without sealed_join — should auto-accept (same wallet, same approved scope)
      transport.receive({
        v: 1,
        t: 'join',
        ch: session.channelId,
        ts: Date.now(),
        from: walletKp.publicKeyB64,
        body: { sealed_join: null },
      } as ProtocolMessage)

      // First join auto-accepted + rejoin auto-accepted = 2 accept messages
      const acceptMessages = transport.sent.filter((m) => m.t === 'accept')
      expect(acceptMessages).toHaveLength(2)
    })

    it('auto-accepts new wallet on rejoin (different pubkey)', async () => {
      await session.createPairing()
      const walletKp = generateX25519KeyPair()
      const walletKp2 = generateX25519KeyPair()

      // First join (auto-accepted)
      receiveFreshJoin(transport, session, walletKp)
      receiveConnected(transport, session, walletKp.publicKeyB64)

      // Second join with different wallet — also auto-accepted (sealed_join decryption proves possession)
      receiveFreshJoin(transport, session, walletKp2)

      const acceptMessages = transport.sent.filter((m) => m.t === 'accept')
      expect(acceptMessages).toHaveLength(2)
    })
  })

  describe('close message handling', () => {
    it('transitions to closed on receiving close', async () => {
      await session.createPairing()
      const walletKp = generateX25519KeyPair()
      transport.receive({
        v: 1,
        t: 'close',
        ch: session.channelId,
        ts: Date.now(),
        from: walletKp.publicKeyB64,
        body: { reason: 'timeout' },
      } as ProtocolMessage)

      expect(session.phase).toBe('closed')
    })
  })

  describe('destroy', () => {
    it('closes and removes all listeners', async () => {
      await session.createPairing()
      const handler = vi.fn()
      session.on('phase', handler)
      session.destroy()

      expect(session.phase).toBe('closed')
      // After destroy, emitting should not call handler
      // (removeAll was called)
    })
  })

  describe('protocol compliance', () => {
    it('rejects messages with from="_adapter" for peer types (§2)', async () => {
      await session.createPairing()
      const errorHandler = vi.fn()
      session.on('error', errorHandler)

      // Send a close message with from: '_adapter' — should be rejected
      transport.receive({
        v: 1,
        t: 'close',
        ch: session.channelId,
        ts: Date.now(),
        from: '_adapter',
        body: { reason: 'normal' },
      } as ProtocolMessage)

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('_adapter'),
        }),
      )
      // Should NOT have processed it as a real close
      expect(session.phase).not.toBe('closed')
    })

    it('rejects messages with unsupported version (§15 rule 12)', async () => {
      await session.createPairing()

      // Send message with v: 2 — should close with unsupported_version
      transport.receive({
        v: 2,
        t: 'close',
        ch: session.channelId,
        ts: Date.now(),
        from: 'somepubkey',
        body: { reason: 'normal' },
      } as unknown as ProtocolMessage)

      expect(session.phase).toBe('closed')
      const closeMsg = transport.sent.find((m) => m.t === 'close') as any
      expect(closeMsg).toBeTruthy()
      expect(closeMsg.body.reason).toBe('unsupported_version')
    })

    it('uses null for missing walletMeta in session context', async () => {
      await session.createPairing()

      // Before any wallet joins, walletMeta should be undefined
      expect(session.walletMeta).toBeUndefined()

      // Access the private sessionContext to verify it uses null (not {})
      const context = (session as any).sessionContext(
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        undefined,
        undefined,
      )
      expect(context.walletMeta).toBeNull()
    })
  })

  describe('auto-accept flow (first join)', () => {
    it('auto-accepts first wallet join with valid sealed_join, skipping pending_accept', async () => {
      const phases: string[] = []
      session.on('phase', (p) => phases.push(p))

      await session.createPairing()
      const walletKp = generateX25519KeyPair()

      receiveFreshJoin(transport, session, walletKp)

      // Auto-accept should have sent an accept message without manual acceptWallet()
      const acceptMsg = transport.sent.find((m) => m.t === 'accept')
      expect(acceptMsg).toBeTruthy()

      // Simulate relay responding with ready.connected
      receiveConnected(transport, session, walletKp.publicKeyB64)

      expect(session.phase).toBe('connected')
      // Phase goes waiting → pending_accept → (auto-accept) → accepting → connected
      // pending_accept is emitted briefly before auto-accept kicks in
      expect(phases).toContain('pending_accept')
    })
  })

  describe('session fingerprint after createPairing', () => {
    it('sessionFingerprint is a 4-digit string and event was emitted', async () => {
      const fpHandler = vi.fn()
      session.on('sessionFingerprint', fpHandler)

      await session.createPairing()

      expect(session.sessionFingerprint).toMatch(/^\d{4}$/)
      expect(fpHandler).toHaveBeenCalledTimes(1)
      expect(fpHandler).toHaveBeenCalledWith(session.sessionFingerprint)
    })
  })

  describe('session fingerprint matches wallet side', () => {
    it('dApp and wallet compute the same fingerprint', async () => {
      await session.createPairing()
      const dappFingerprint = session.sessionFingerprint

      // The dApp computes fingerprint from its own pubkey + channelId
      // The wallet computes it from (channelId, dappPubKeyB64) — same inputs
      const dappPubB64 = dappPubKeyFromCreate(transport)
      const walletSideFingerprint = computeSessionFingerprint(session.channelId, dappPubB64)

      expect(dappFingerprint).toBe(walletSideFingerprint)
      expect(dappFingerprint).toMatch(/^\d{4}$/)
    })
  })

  describe('session TTL enforcement', () => {
    it('closes with reason timeout after TTL expires', async () => {
      vi.useFakeTimers()

      const shortTtlTransport = new MockTransport()
      const shortTtlSession = new DAppSession({
        transport: shortTtlTransport,
        meta: { name: 'T', description: 'T', url: 'https://t.com', icon: 'https://t.com/i.png' },
        sessionTtl: 100,
      })

      await shortTtlSession.createPairing()
      const walletKp = generateX25519KeyPair()

      // Simulate wallet join
      shortTtlTransport.receive({
        v: 1,
        t: 'join',
        ch: shortTtlSession.channelId,
        ts: Date.now(),
        from: walletKp.publicKeyB64,
        body: makeJoinBody(
          shortTtlSession.channelId,
          shortTtlTransport.sent.find((m) => m.t === 'create')?.from!,
          walletKp,
        ),
      } as ProtocolMessage)

      // Simulate ready.connected (this starts the TTL timer)
      shortTtlTransport.receive({
        v: 1,
        t: 'ready',
        ch: shortTtlSession.channelId,
        ts: Date.now(),
        from: '_adapter',
        body: { state: 'connected', reconnect: false, remote: walletKp.publicKeyB64 },
      } as ProtocolMessage)

      expect(shortTtlSession.phase).toBe('connected')

      const errorHandler = vi.fn()
      shortTtlSession.on('error', errorHandler)

      // Advance time past the TTL
      vi.advanceTimersByTime(150)

      expect(shortTtlSession.phase).toBe('closed')
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('expired'),
        }),
      )

      // Verify close message was sent with reason 'timeout'
      const closeMsg = shortTtlTransport.sent.find((m) => m.t === 'close')
      expect(closeMsg).toBeTruthy()
      expect((closeMsg as any).body.reason).toBe('timeout')

      vi.useRealTimers()
    })
  })

  describe('terminate handling / reconnect', () => {
    async function connect(): Promise<ReturnType<typeof generateX25519KeyPair>> {
      await session.createPairing()
      const walletKp = generateX25519KeyPair()
      receiveFreshJoin(transport, session, walletKp)
      receiveConnected(transport, session, walletKp.publicKeyB64)
      expect(session.phase).toBe('connected')
      return walletKp
    }

    function receiveTerminate(reason: string): void {
      transport.receive({
        v: 1,
        t: 'terminate',
        ch: session.channelId,
        ts: Date.now(),
        from: '_adapter',
        body: { reason },
      } as ProtocolMessage)
    }

    beforeEach(() => {
      clearDisconnectLog()
    })

    it('does NOT permanently close on a recoverable terminate (rate_limited)', async () => {
      await connect()
      receiveTerminate('rate_limited')
      // The bug was: any terminate → closed forever. Now: stay recoverable.
      expect(session.phase).toBe('disconnected')
      expect(session.phase).not.toBe('closed')
    })

    it.each([
      'channel_not_found',
      'payload_too_large',
      'timeout',
      'invalid_state',
    ])('stays recoverable on terminate reason %s', async (reason) => {
      await connect()
      receiveTerminate(reason)
      expect(session.phase).toBe('disconnected')
    })

    it.each([
      'normal',
      'user_rejected',
      'unsupported_version',
    ])('permanently closes on terminal terminate reason %s', async (reason) => {
      await connect()
      receiveTerminate(reason)
      expect(session.phase).toBe('closed')
    })

    it('records the terminate in the developer disconnect log with willReconnect', async () => {
      await connect()
      receiveTerminate('rate_limited')
      const entry = getDisconnectLog().find((e) => e.kind === 'terminate')
      expect(entry).toMatchObject({
        side: 'dapp',
        kind: 'terminate',
        reason: 'rate_limited',
        willReconnect: true,
      })
    })

    it('records willReconnect=false for a terminal terminate', async () => {
      await connect()
      receiveTerminate('user_rejected')
      const entry = getDisconnectLog().find((e) => e.kind === 'terminate')
      expect(entry).toMatchObject({ reason: 'user_rejected', willReconnect: false })
    })

    it('actually attempts to reconnect (sends a fresh create) after a recoverable terminate', async () => {
      vi.useFakeTimers()
      try {
        await session.createPairing()
        const walletKp = generateX25519KeyPair()
        receiveFreshJoin(transport, session, walletKp)
        receiveConnected(transport, session, walletKp.publicKeyB64)
        expect(session.phase).toBe('connected')

        const createsBefore = transport.sent.filter((m) => m.t === 'create').length
        receiveTerminate('rate_limited')
        expect(session.phase).toBe('disconnected')

        // Advance past the first backoff (1000ms + up to 30% jitter).
        await vi.advanceTimersByTimeAsync(1500)
        const createsAfter = transport.sent.filter((m) => m.t === 'create').length
        expect(createsAfter).toBeGreaterThan(createsBefore)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('request resilience across reconnect (P0-1)', () => {
    async function connectWithKeys(s: DAppSession = session): Promise<{
      walletKp: ReturnType<typeof generateX25519KeyPair>
      sendKey: Uint8Array
      walletToDappKey: Uint8Array
    }> {
      await s.createPairing()
      const walletKp = generateX25519KeyPair()
      receiveFreshJoin(transport, s, walletKp)
      receiveConnected(transport, s, walletKp.publicKeyB64)
      expect(s.phase).toBe('connected')
      return {
        walletKp,
        sendKey: (s as any).sendKey as Uint8Array, // dappToWalletKey
        walletToDappKey: (s as any).recvKey as Uint8Array,
      }
    }

    const reqFrames = () => transport.sent.filter((m) => m.t === 'req') as any[]

    function decodeReq(frame: any, sendKey: Uint8Array): { seq: number; data: unknown } {
      const { seq, data } = unsealPayload(sendKey, session.channelId, frame.body.sealed, {
        type: 'req',
        from: frame.from,
        id: frame.body.id,
      })
      return { seq, data }
    }

    it('re-sends in-flight requests with same id and a fresh seq after reconnect', async () => {
      vi.useFakeTimers()
      try {
        const { walletKp, sendKey, walletToDappKey } = await connectWithKeys()

        const promise = session.request('wallet_getAccounts', { foo: 'bar' })
        const first = reqFrames()
        expect(first).toHaveLength(1)
        const firstDecoded = decodeReq(first[0], sendKey)

        // Transport drops mid-request → reconnect cycle begins.
        transport.simulateClose({ code: 1006 })
        expect(session.phase).toBe('disconnected')

        // Advance past the first backoff → fresh `create`, transport reconnected.
        await vi.advanceTimersByTimeAsync(1500)
        // Relay reports the channel connected again.
        receiveConnected(transport, session, walletKp.publicKeyB64)
        expect(session.phase).toBe('connected')

        // The same request was re-sent: same id, new (higher) seq, same payload.
        const second = reqFrames()
        expect(second).toHaveLength(2)
        expect(second[1].body.id).toBe(first[0].body.id)
        const secondDecoded = decodeReq(second[1], sendKey)
        expect(secondDecoded.seq).toBeGreaterThan(firstDecoded.seq)
        expect(secondDecoded.data).toEqual(firstDecoded.data)

        // Responding to the re-sent request resolves the original promise.
        const id = second[1].body.id
        transport.receive({
          v: 1,
          t: 'res',
          ch: session.channelId,
          ts: Date.now(),
          from: walletKp.publicKeyB64,
          body: {
            id,
            sealed: sealPayload(
              walletToDappKey,
              session.channelId,
              0,
              { _ok: true, _result: ['0xabc'] },
              { type: 'res', from: walletKp.publicKeyB64, id },
            ),
          },
        } as ProtocolMessage)
        await expect(promise).resolves.toEqual(['0xabc'])
      } finally {
        vi.useRealTimers()
      }
    })

    it('does NOT re-send when resendOnReconnect is false', async () => {
      vi.useFakeTimers()
      const noResend = new DAppSession({
        transport,
        meta: { name: 'x', description: '', url: '', icon: '' },
        resendOnReconnect: false,
      })
      try {
        const { walletKp } = await connectWithKeys(noResend)
        const p = noResend.request('wallet_getAccounts')
        p.catch(() => {}) // keep unhandled rejection quiet
        expect(reqFrames()).toHaveLength(1)

        transport.simulateClose({ code: 1006 })
        await vi.advanceTimersByTimeAsync(1500)
        receiveConnected(transport, noResend, walletKp.publicKeyB64)

        expect(reqFrames()).toHaveLength(1) // no re-send
        noResend.close()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('reject pending on inbound close / terminate (P0-3)', () => {
    async function connectSession(): Promise<ReturnType<typeof generateX25519KeyPair>> {
      await session.createPairing()
      const walletKp = generateX25519KeyPair()
      receiveFreshJoin(transport, session, walletKp)
      receiveConnected(transport, session, walletKp.publicKeyB64)
      expect(session.phase).toBe('connected')
      return walletKp
    }

    function receiveTerminate(reason: string): void {
      transport.receive({
        v: 1,
        t: 'terminate',
        ch: session.channelId,
        ts: Date.now(),
        from: '_adapter',
        body: { reason },
      } as ProtocolMessage)
    }

    it('rejects pending requests immediately on an inbound close', async () => {
      const walletKp = await connectSession()
      const p = session.request('wallet_getAccounts')
      const rejected = expect(p).rejects.toThrow('Session closed by peer')
      transport.receive({
        v: 1,
        t: 'close',
        ch: session.channelId,
        ts: Date.now(),
        from: walletKp.publicKeyB64,
        body: { reason: 'normal' },
      } as ProtocolMessage)
      await rejected
      expect(session.phase).toBe('closed')
      expect((session as any).pendingRequests.size).toBe(0)
    })

    it('rejects pending requests immediately on a terminal terminate', async () => {
      await connectSession()
      const p = session.request('wallet_getAccounts')
      const rejected = expect(p).rejects.toThrow('Session terminated: user_rejected')
      receiveTerminate('user_rejected')
      await rejected
      expect(session.phase).toBe('closed')
      expect((session as any).pendingRequests.size).toBe(0)
    })

    it('keeps pending requests on a recoverable terminate (they are re-sent on reconnect)', async () => {
      await connectSession()
      const p = session.request('wallet_getAccounts')
      let settled = false
      p.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )
      receiveTerminate('rate_limited')
      await flushMicrotasks()
      expect(session.phase).toBe('disconnected')
      expect(settled).toBe(false)
      expect((session as any).pendingRequests.size).toBe(1)
      session.close() // cleanup (rejects the still-pending promise, already caught)
    })
  })

  describe('heartbeat / liveness (P0-2)', () => {
    async function connectHb(opts: Record<string, unknown>): Promise<{
      s: DAppSession
      walletKp: ReturnType<typeof generateX25519KeyPair>
    }> {
      const s = new DAppSession({
        transport,
        meta: { name: 'hb', description: '', url: '', icon: '' },
        ...opts,
      })
      await s.createPairing()
      const walletKp = generateX25519KeyPair()
      receiveFreshJoin(transport, s, walletKp)
      receiveConnected(transport, s, walletKp.publicKeyB64)
      expect(s.phase).toBe('connected')
      return { s, walletKp }
    }

    const pings = () => transport.sent.filter((m) => m.t === 'ping').length

    it('pings on the interval and forces a reconnect when no pong arrives', async () => {
      vi.useFakeTimers()
      let s: DAppSession | undefined
      try {
        const conn = await connectHb({ heartbeatInterval: 1000, heartbeatTimeout: 500 })
        s = conn.s
        const disconnectSpy = vi.spyOn(transport, 'disconnect')
        const before = pings()

        await vi.advanceTimersByTimeAsync(1000) // one interval → a ping
        expect(pings()).toBe(before + 1)

        await vi.advanceTimersByTimeAsync(500) // no pong within timeout → dead
        expect(disconnectSpy).toHaveBeenCalled()
        expect(s.phase).toBe('disconnected')
      } finally {
        vi.useRealTimers()
        s?.close()
      }
    })

    it('stays connected while pongs keep arriving', async () => {
      vi.useFakeTimers()
      let s: DAppSession | undefined
      try {
        const conn = await connectHb({ heartbeatInterval: 1000, heartbeatTimeout: 500 })
        s = conn.s
        const disconnectSpy = vi.spyOn(transport, 'disconnect')

        await vi.advanceTimersByTimeAsync(1000) // ping sent, awaiting pong
        transport.receive({
          v: 1,
          t: 'pong',
          ch: s.channelId,
          ts: Date.now(),
          from: conn.walletKp.publicKeyB64,
          body: {},
        } as ProtocolMessage)

        await vi.advanceTimersByTimeAsync(1000) // would have fired liveness without the pong
        expect(disconnectSpy).not.toHaveBeenCalled()
        expect(s.phase).toBe('connected')
      } finally {
        vi.useRealTimers()
        s?.close()
      }
    })

    it('does not start a heartbeat when heartbeatInterval is 0', async () => {
      vi.useFakeTimers()
      let s: DAppSession | undefined
      try {
        const conn = await connectHb({ heartbeatInterval: 0 })
        s = conn.s
        const disconnectSpy = vi.spyOn(transport, 'disconnect')
        await vi.advanceTimersByTimeAsync(60_000)
        expect(pings()).toBe(0)
        expect(disconnectSpy).not.toHaveBeenCalled()
        expect(s.phase).toBe('connected')
      } finally {
        vi.useRealTimers()
        s?.close()
      }
    })
  })

  describe('bounded reconnect + cleanup (P0-4)', () => {
    it('gives up after maxReconnectAttempts, emits reconnectExhausted, rejects pending', async () => {
      vi.useFakeTimers()
      const s = new DAppSession({
        transport,
        meta: { name: 'x', description: '', url: '', icon: '' },
        maxReconnectAttempts: 2,
        heartbeatInterval: 0,
      })
      let exhausted: { attempts: number } | undefined
      s.on('reconnectExhausted', (e) => {
        exhausted = e as { attempts: number }
      })
      try {
        await s.createPairing()
        const walletKp = generateX25519KeyPair()
        receiveFreshJoin(transport, s, walletKp)
        receiveConnected(transport, s, walletKp.publicKeyB64)
        expect(s.phase).toBe('connected')

        const p = s.request('wallet_getAccounts')
        const rejected = expect(p).rejects.toThrow(/Reconnect failed/)

        // Every reconnect attempt now fails at the transport level.
        ;(transport as unknown as { connect: () => Promise<void> }).connect = async () => {
          throw new Error('connect failed')
        }
        transport.simulateClose({ code: 1006 })

        await vi.advanceTimersByTimeAsync(15_000)

        expect(exhausted).toBeDefined()
        expect(exhausted?.attempts).toBeGreaterThanOrEqual(2)
        expect(s.phase).toBe('closed')
        await rejected
      } finally {
        vi.useRealTimers()
      }
    })

    it('clears the pending-accept timer on a transport drop (no bogus close)', async () => {
      vi.useFakeTimers()
      const s = new DAppSession({
        transport,
        meta: { name: 'x', description: '', url: '', icon: '' },
        autoAccept: false,
        heartbeatInterval: 0,
      })
      try {
        await s.createPairing()
        const walletKp = generateX25519KeyPair()
        receiveFreshJoin(transport, s, walletKp)
        expect(s.phase).toBe('pending_accept') // 60s accept timer armed

        transport.simulateClose({ code: 1006 })
        expect(s.phase).toBe('disconnected')

        // Past the 60s accept timeout. Without the cleanup, the stale accept
        // timer would fire close('timeout') and move the session to 'closed'.
        await vi.advanceTimersByTimeAsync(70_000)
        expect(s.phase).not.toBe('closed')
      } finally {
        vi.useRealTimers()
        s.close()
      }
    })
  })
})
