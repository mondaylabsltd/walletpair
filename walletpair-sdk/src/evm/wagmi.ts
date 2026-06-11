/**
 * Wagmi connector for WalletPair.
 *
 * Usage:
 *   import { walletPair } from 'walletpair-sdk/evm/wagmi'
 *   import { createConfig } from 'wagmi'
 *
 *   const config = createConfig({
 *     connectors: [
 *       walletPair({
 *         relayUrl: 'wss://relay.walletpair.org/v1',
 *         meta: { name: 'MyDApp', description: 'A dApp', url: 'https://mydapp.com', icon: 'https://mydapp.com/icon.png' },
 *         onPairingUri: (uri) => { showQrCode(uri) },
 *         onSessionFingerprint: (fp) => { showFingerprint(fp) },
 *       }),
 *     ],
 *   })
 */

import { DAppSession } from '../dapp-session.js'
import type { SessionPersistence, Transport } from '../types.js'
import { evmNumericChainId } from '../types.js'
import { WebSocketTransport } from '../ws-transport.js'
import { WalletPairProvider } from './eip1193.js'

// ---------------------------------------------------------------------------
// Wagmi types (minimal subset to avoid hard dependency)
// ---------------------------------------------------------------------------

interface Chain {
  id: number
  name: string
  [key: string]: unknown
}

interface ConnectorEventMap {
  change: { accounts?: readonly string[] | undefined; chainId?: number | undefined }
  connect: { accounts: readonly string[]; chainId: number }
  disconnect: never
  error: { error: Error }
  message: { type: string; data?: unknown | undefined }
}

interface WagmiEmitter {
  emit<K extends keyof ConnectorEventMap>(event: K, data: ConnectorEventMap[K]): void
  on<K extends keyof ConnectorEventMap>(
    event: K,
    handler: (data: ConnectorEventMap[K]) => void,
  ): void
  off<K extends keyof ConnectorEventMap>(
    event: K,
    handler: (data: ConnectorEventMap[K]) => void,
  ): void
  listenerCount(event: keyof ConnectorEventMap): number
}

interface Storage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

interface ConnectorConfig {
  chains: readonly [Chain, ...Chain[]]
  emitter: WagmiEmitter
  storage?: Storage | null | undefined
}

type CreateConnectorFn = (config: ConnectorConfig) => {
  id: string
  name: string
  type: string
  icon?: string | undefined
  connect(params?: {
    chainId?: number | undefined
    isReconnecting?: boolean | undefined
  }): Promise<{ accounts: readonly string[]; chainId: number }>
  disconnect(): Promise<void>
  getAccounts(): Promise<readonly string[]>
  getChainId(): Promise<number>
  getProvider(params?: { chainId?: number | undefined }): Promise<WalletPairProvider>
  isAuthorized(): Promise<boolean>
  onAccountsChanged(accounts: string[]): void
  onChainChanged(chainId: string): void
  onConnect?(connectInfo: { chainId: string }): void
  onDisconnect(error?: Error | undefined): void
  setup?(): Promise<void>
  switchChain?(params: { chainId: number }): Promise<Chain>
}

// ---------------------------------------------------------------------------
// Connector options
// ---------------------------------------------------------------------------

export interface WalletPairConnectorOptions {
  /** WebSocket relay URL. Used when `transport` is not provided. */
  relayUrl?: string | undefined
  /** Custom transport instance. Overrides relayUrl when provided. */
  transport?: Transport | undefined
  /** DApp metadata (name, description, url, icon). */
  meta: { name: string; description: string; url: string; icon: string }
  /** Request timeout in ms. */
  requestTimeout?: number | undefined
  /** Called when a pairing URI is generated (display QR code). */
  onPairingUri?: ((uri: string) => void) | undefined
  /** Called when the session fingerprint is ready (display alongside QR). */
  onSessionFingerprint?: ((fingerprint: string) => void) | undefined
}

// ---------------------------------------------------------------------------
// Connector factory
// ---------------------------------------------------------------------------

export function walletPair(options: WalletPairConnectorOptions): CreateConnectorFn {
  let session: DAppSession | null = null
  let provider: WalletPairProvider | null = null
  let sessionEventsBound = false

  function persistenceFromStorage(
    storage?: Storage | null | undefined,
  ): SessionPersistence | undefined {
    if (!storage) return undefined
    return {
      save: (snapshot) => storage.setItem('walletPair.session', snapshot),
      load: () => storage.getItem('walletPair.session'),
      clear: () => storage.removeItem('walletPair.session'),
    }
  }

  function getOrCreateSession(config?: ConnectorConfig): DAppSession {
    if (!session) {
      const transport =
        options.transport ??
        (() => {
          if (!options.relayUrl) {
            throw new Error('WalletPair requires either relayUrl or transport')
          }
          return new WebSocketTransport(options.relayUrl)
        })()
      session = new DAppSession({
        transport,
        meta: options.meta,
        requestTimeout: options.requestTimeout,
        persistence: persistenceFromStorage(config?.storage),
      })
    }
    return session
  }

  function getOrCreateProvider(chainId?: number, config?: ConnectorConfig): WalletPairProvider {
    if (!provider) {
      provider = new WalletPairProvider({
        session: getOrCreateSession(config),
        chainId,
      })
    }
    return provider
  }

  function bindSessionEvents(config: ConnectorConfig, chainId: number): void {
    const s = getOrCreateSession(config)
    if (sessionEventsBound) return
    sessionEventsBound = true

    // Bridge WalletPair events → wagmi emitter
    s.on('event', ({ event, data }) => {
      if (event === 'accountsChanged') {
        const accts = (data as { accounts?: string[] })?.accounts ?? (data as string[])
        if (Array.isArray(accts)) {
          config.emitter.emit('change', { accounts: accts })
        }
      } else if (event === 'chainChanged') {
        const raw = (data as { chainId?: string | number })?.chainId ?? data
        let newId: number
        if (typeof raw === 'string' && raw.startsWith('eip155:')) {
          newId = evmNumericChainId(raw) ?? chainId
        } else if (typeof raw === 'string') {
          newId = Number.parseInt(raw, raw.startsWith('0x') ? 16 : 10)
        } else {
          newId = raw as number
        }
        config.emitter.emit('change', { chainId: newId })
      }
    })

    // A permanently-closed session (graceful close, terminal terminate, or
    // exhausted reconnect) must move wagmi to a disconnected state — otherwise
    // wagmi keeps showing "connected" against a dead session.
    s.on('phase', (phase) => {
      if (phase === 'closed') config.emitter.emit('disconnect', undefined as never)
    })

    // Auto-reconnect gave up: surface it as a wagmi error (the disconnect itself
    // is emitted by the phase→closed handler above).
    s.on('reconnectExhausted', ({ attempts }) => {
      config.emitter.emit('error', {
        error: new Error(`WalletPair reconnect failed after ${attempts} attempts`),
      })
    })
  }

  async function requestAccountsWhenConnected(
    s: DAppSession,
    p: WalletPairProvider,
  ): Promise<readonly string[]> {
    if (s.phase === 'connected') {
      return (await p.request({ method: 'eth_requestAccounts' })) as string[]
    }

    return new Promise<readonly string[]>((resolve, reject) => {
      const cleanup: (() => void)[] = []

      cleanup.push(
        s.on('phase', async (phase) => {
          if (phase === 'connected') {
            try {
              const accts = (await p.request({ method: 'eth_requestAccounts' })) as string[]
              for (const off of cleanup) off()
              resolve(accts)
            } catch (e) {
              for (const off of cleanup) off()
              reject(e)
            }
          } else if (phase === 'closed') {
            for (const off of cleanup) off()
            reject(new Error('Session closed'))
          }
        }),
      )
    })
  }

  return (config: ConnectorConfig) => {
    return {
      id: 'walletPair',
      name: options.meta.name,
      type: 'walletPair',

      async connect(params) {
        const chainId = params?.chainId ?? config.chains[0].id
        const s = getOrCreateSession(config)
        const p = getOrCreateProvider(chainId, config)

        bindSessionEvents(config, chainId)

        if (params?.isReconnecting) {
          const restored = await s.restoreFromPersistence()
          if (!restored) throw new Error('No persisted WalletPair session')
          await s.reconnect()
          const accounts = await requestAccountsWhenConnected(s, p)
          return { accounts, chainId }
        }

        // Start pairing flow
        const uri = await s.createPairing()
        options.onPairingUri?.(uri)

        // Emit session fingerprint for display alongside QR
        options.onSessionFingerprint?.(s.sessionFingerprint)

        // Wait for wallet to join (auto-accepted after sealed_join verification)
        const accounts = await requestAccountsWhenConnected(s, p)

        // DAppSession persists snapshots write-ahead through config.storage.

        return { accounts, chainId }
      },

      async disconnect() {
        session?.close()
        session = null
        provider = null
        sessionEventsBound = false
        if (config.storage) {
          await config.storage.removeItem('walletPair.session')
        }
      },

      async getAccounts() {
        return getOrCreateProvider(undefined, config).getAccounts()
      },

      async getChainId() {
        return Number.parseInt(getOrCreateProvider(undefined, config).getChainId(), 16)
      },

      async getProvider() {
        return getOrCreateProvider(undefined, config)
      },

      async isAuthorized() {
        // Pure predicate: report only whether a reconnectable snapshot exists,
        // without restoring it into (and mutating) the live session. The actual
        // restore + reconnect happens in connect({ isReconnecting: true }). The
        // old implementation called restoreFromPersistence() here, which (a) had
        // a side effect on every page load and (b) reported a dead session as
        // authorized purely because a stale snapshot was present.
        if (!config.storage) return false
        const snapshot = await config.storage.getItem('walletPair.session')
        return !!snapshot
      },

      onAccountsChanged(accounts: string[]) {
        config.emitter.emit('change', { accounts })
      },

      onChainChanged(chainId: string) {
        config.emitter.emit('change', { chainId: Number.parseInt(chainId, 16) })
      },

      onDisconnect() {
        config.emitter.emit('disconnect', undefined as never)
      },

      async switchChain(params) {
        const p = getOrCreateProvider(undefined, config)
        await p.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${params.chainId.toString(16)}` }],
        })
        config.emitter.emit('change', { chainId: params.chainId })
        const chain = config.chains.find((c) => c.id === params.chainId)
        if (!chain) throw new Error(`Chain ${params.chainId} not configured`)
        return chain
      },
    }
  }
}
