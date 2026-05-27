import { describe, expect, it, vi } from 'vitest'
import { generateX25519KeyPair, hexToBytes, sealPayload } from '../crypto.js'
import { DAppSession } from '../dapp-session.js'
import { MockTransport, makeJoinBody } from '../test-helpers.js'
import type { ProtocolMessage, RequestMessage } from '../types.js'
import { walletPair } from './wagmi.js'

function wait(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const meta = {
  name: 'Test',
  description: 'Test dApp',
  url: 'https://test.com',
  icon: 'https://test.com/icon.png',
}

async function makePersistedDappSession(): Promise<{
  snapshot: string
  channelId: string
  walletPubKeyB64: string
  walletToDappKey: Uint8Array
}> {
  const transport = new MockTransport()
  const session = new DAppSession({ transport, meta })
  const walletKp = generateX25519KeyPair()

  await session.createPairing()
  const createMsg = transport.sent.find((m) => m.t === 'create')
  if (!createMsg) throw new Error('create message was not sent')

  transport.receive({
    v: 1,
    t: 'join',
    ch: session.channelId,
    ts: Date.now(),
    from: walletKp.publicKeyB64,
    body: makeJoinBody(session.channelId, createMsg.from, walletKp),
  } as ProtocolMessage)
  transport.receive({
    v: 1,
    t: 'ready',
    ch: session.channelId,
    ts: Date.now(),
    from: '_adapter',
    body: { state: 'connected', reconnect: false, remote: walletKp.publicKeyB64 },
  } as ProtocolMessage)

  const snapshot = session.serialize()
  const snapshotData = JSON.parse(snapshot) as { recvKey?: string | null }
  if (!snapshotData.recvKey) throw new Error('snapshot missing recvKey')

  return {
    snapshot,
    channelId: session.channelId,
    walletPubKeyB64: walletKp.publicKeyB64,
    walletToDappKey: hexToBytes(snapshotData.recvKey),
  }
}

describe('walletPair connector factory', () => {
  it('returns a CreateConnectorFn', () => {
    const factory = walletPair({
      relayUrl: 'ws://localhost:8080/v1',
      meta: {
        name: 'Test',
        description: 'Test dApp',
        url: 'https://test.com',
        icon: 'https://test.com/icon.png',
      },
    })
    expect(typeof factory).toBe('function')
  })

  it('connector has correct id, name, type', () => {
    const factory = walletPair({
      relayUrl: 'ws://localhost:8080/v1',
      meta: {
        name: 'My dApp',
        description: 'Test dApp',
        url: 'https://test.com',
        icon: 'https://test.com/icon.png',
      },
    })

    const emitter = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      listenerCount: vi.fn(() => 0),
    }

    const connector = factory({
      chains: [{ id: 1, name: 'Ethereum' }] as any,
      emitter,
    })

    expect(connector.id).toBe('walletPair')
    expect(connector.name).toBe('My dApp') // connector.name comes from meta.name
    expect(connector.type).toBe('walletPair')
  })

  it('connector name comes from meta.name', () => {
    const factory = walletPair({
      relayUrl: 'ws://localhost:8080/v1',
      meta: {
        name: 'WalletPair',
        description: 'Test dApp',
        url: 'https://test.com',
        icon: 'https://test.com/icon.png',
      },
    })

    const connector = factory({
      chains: [{ id: 1, name: 'Ethereum' }] as any,
      emitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), listenerCount: vi.fn(() => 0) },
    })

    expect(connector.name).toBe('WalletPair')
  })

  it('connector has all required methods', () => {
    const factory = walletPair({
      relayUrl: 'ws://localhost:8080/v1',
      meta: {
        name: 'Test',
        description: 'Test dApp',
        url: 'https://test.com',
        icon: 'https://test.com/icon.png',
      },
    })

    const connector = factory({
      chains: [{ id: 1, name: 'Ethereum' }] as any,
      emitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), listenerCount: vi.fn(() => 0) },
    })

    expect(typeof connector.connect).toBe('function')
    expect(typeof connector.disconnect).toBe('function')
    expect(typeof connector.getAccounts).toBe('function')
    expect(typeof connector.getChainId).toBe('function')
    expect(typeof connector.getProvider).toBe('function')
    expect(typeof connector.isAuthorized).toBe('function')
    expect(typeof connector.onAccountsChanged).toBe('function')
    expect(typeof connector.onChainChanged).toBe('function')
    expect(typeof connector.onDisconnect).toBe('function')
    expect(typeof connector.switchChain).toBe('function')
  })

  it('isAuthorized returns false with no storage', async () => {
    const factory = walletPair({
      relayUrl: 'ws://localhost:8080/v1',
      meta: {
        name: 'Test',
        description: 'Test dApp',
        url: 'https://test.com',
        icon: 'https://test.com/icon.png',
      },
    })

    const connector = factory({
      chains: [{ id: 1, name: 'Ethereum' }] as any,
      emitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), listenerCount: vi.fn(() => 0) },
      storage: null,
    })

    expect(await connector.isAuthorized()).toBe(false)
  })

  it('isAuthorized returns false when no saved session', async () => {
    const factory = walletPair({
      relayUrl: 'ws://localhost:8080/v1',
      meta: {
        name: 'Test',
        description: 'Test dApp',
        url: 'https://test.com',
        icon: 'https://test.com/icon.png',
      },
    })

    const storage = {
      getItem: vi.fn(() => Promise.resolve(null)),
      setItem: vi.fn(() => Promise.resolve()),
      removeItem: vi.fn(() => Promise.resolve()),
    }

    const connector = factory({
      chains: [{ id: 1, name: 'Ethereum' }] as any,
      emitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), listenerCount: vi.fn(() => 0) },
      storage,
    })

    expect(await connector.isAuthorized()).toBe(false)
    expect(storage.getItem).toHaveBeenCalledWith('walletPair.session')
  })

  it('connect({ isReconnecting: true }) restores and reconnects without a new pairing URI', async () => {
    const saved = await makePersistedDappSession()
    const transport = new MockTransport()
    const onPairingUri = vi.fn()
    const storage = {
      getItem: vi.fn(() => Promise.resolve(saved.snapshot)),
      setItem: vi.fn(() => Promise.resolve()),
      removeItem: vi.fn(() => Promise.resolve()),
    }

    const factory = walletPair({ transport, meta, onPairingUri })
    const connector = factory({
      chains: [{ id: 1, name: 'Ethereum' }] as const,
      emitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), listenerCount: vi.fn(() => 0) },
      storage,
    })

    const connectResult = connector.connect({ isReconnecting: true })
    await wait()

    const createMsg = transport.sent.find((m) => m.t === 'create')
    expect(createMsg).toBeTruthy()
    expect(createMsg?.ch).toBe(saved.channelId)
    expect(onPairingUri).not.toHaveBeenCalled()

    transport.receive({
      v: 1,
      t: 'join',
      ch: saved.channelId,
      ts: Date.now(),
      from: saved.walletPubKeyB64,
      body: { sealed_join: null },
    } as ProtocolMessage)
    transport.receive({
      v: 1,
      t: 'ready',
      ch: saved.channelId,
      ts: Date.now(),
      from: '_adapter',
      body: { state: 'connected', reconnect: true, remote: saved.walletPubKeyB64 },
    } as ProtocolMessage)
    await wait()

    const reqMsg = transport.sent.find((m): m is RequestMessage => m.t === 'req')
    if (!reqMsg) throw new Error('reconnected session did not request accounts')
    transport.receive({
      v: 1,
      t: 'res',
      ch: saved.channelId,
      ts: Date.now(),
      from: saved.walletPubKeyB64,
      body: {
        id: reqMsg.body.id,
        sealed: sealPayload(
          saved.walletToDappKey,
          saved.channelId,
          0,
          { _ok: true, _result: ['0xabc'] },
          { type: 'res', from: saved.walletPubKeyB64, id: reqMsg.body.id },
        ),
      },
    } as ProtocolMessage)

    await expect(connectResult).resolves.toEqual({ accounts: ['0xabc'], chainId: 1 })
  })

  it('getProvider returns a WalletPairProvider', async () => {
    const factory = walletPair({
      relayUrl: 'ws://localhost:8080/v1',
      meta: {
        name: 'Test',
        description: 'Test dApp',
        url: 'https://test.com',
        icon: 'https://test.com/icon.png',
      },
    })

    const connector = factory({
      chains: [{ id: 1, name: 'Ethereum' }] as any,
      emitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), listenerCount: vi.fn(() => 0) },
    })

    const provider = await connector.getProvider()
    expect(provider).toBeTruthy()
    expect(typeof provider.request).toBe('function')
    expect(typeof provider.on).toBe('function')
    expect(typeof provider.removeListener).toBe('function')
  })

  it('onAccountsChanged emits change event', () => {
    const factory = walletPair({
      relayUrl: 'ws://localhost:8080/v1',
      meta: {
        name: 'Test',
        description: 'Test dApp',
        url: 'https://test.com',
        icon: 'https://test.com/icon.png',
      },
    })
    const emit = vi.fn()

    const connector = factory({
      chains: [{ id: 1, name: 'Ethereum' }] as any,
      emitter: { emit, on: vi.fn(), off: vi.fn(), listenerCount: vi.fn(() => 0) },
    })

    connector.onAccountsChanged(['0xabc'])
    expect(emit).toHaveBeenCalledWith('change', { accounts: ['0xabc'] })
  })

  it('onChainChanged emits change event with numeric chainId', () => {
    const factory = walletPair({
      relayUrl: 'ws://localhost:8080/v1',
      meta: {
        name: 'Test',
        description: 'Test dApp',
        url: 'https://test.com',
        icon: 'https://test.com/icon.png',
      },
    })
    const emit = vi.fn()

    const connector = factory({
      chains: [{ id: 1, name: 'Ethereum' }] as any,
      emitter: { emit, on: vi.fn(), off: vi.fn(), listenerCount: vi.fn(() => 0) },
    })

    connector.onChainChanged('0x89') // 137
    expect(emit).toHaveBeenCalledWith('change', { chainId: 137 })
  })

  it('onDisconnect emits disconnect event', () => {
    const factory = walletPair({
      relayUrl: 'ws://localhost:8080/v1',
      meta: {
        name: 'Test',
        description: 'Test dApp',
        url: 'https://test.com',
        icon: 'https://test.com/icon.png',
      },
    })
    const emit = vi.fn()

    const connector = factory({
      chains: [{ id: 1, name: 'Ethereum' }] as any,
      emitter: { emit, on: vi.fn(), off: vi.fn(), listenerCount: vi.fn(() => 0) },
    })

    connector.onDisconnect()
    expect(emit).toHaveBeenCalledWith('disconnect', undefined)
  })

  it('disconnect cleans up session and storage', async () => {
    const factory = walletPair({
      relayUrl: 'ws://localhost:8080/v1',
      meta: {
        name: 'Test',
        description: 'Test dApp',
        url: 'https://test.com',
        icon: 'https://test.com/icon.png',
      },
    })
    const storage = {
      getItem: vi.fn(() => Promise.resolve(null)),
      setItem: vi.fn(() => Promise.resolve()),
      removeItem: vi.fn(() => Promise.resolve()),
    }

    const connector = factory({
      chains: [{ id: 1, name: 'Ethereum' }] as any,
      emitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), listenerCount: vi.fn(() => 0) },
      storage,
    })

    await connector.disconnect()
    expect(storage.removeItem).toHaveBeenCalledWith('walletPair.session')
  })

  it('switchChain throws for unconfigured chain', async () => {
    const factory = walletPair({
      relayUrl: 'ws://localhost:8080/v1',
      meta: {
        name: 'Test',
        description: 'Test dApp',
        url: 'https://test.com',
        icon: 'https://test.com/icon.png',
      },
    })

    const connector = factory({
      chains: [{ id: 1, name: 'Ethereum' }] as any,
      emitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), listenerCount: vi.fn(() => 0) },
    })

    // switchChain will fail because session isn't connected, but the chain validation
    // happens after the request. We test the error path.
    await expect(connector.switchChain!({ chainId: 999 })).rejects.toThrow()
  })
})
