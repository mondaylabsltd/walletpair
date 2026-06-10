/**
 * WebSocket transport for WalletPair protocol.
 *
 * Works in browsers, Node.js 22+, Deno, Bun — anything with a global WebSocket.
 */

import type { ProtocolMessage, Transport, TransportCloseInfo, TransportState } from './types.js'

/** Max frames buffered while a (re)connect is in flight before dropping oldest. */
const MAX_OUTBOUND_QUEUE = 64
/** Inbound frames larger than this are dropped before JSON.parse (DoS backstop;
 * the protocol caps messages at 64 KB, this leaves generous slack). */
const MAX_INBOUND_BYTES = 128 * 1024
/** Default time to wait for the socket to open before failing connect(). */
const DEFAULT_CONNECT_TIMEOUT = 15_000

export interface WebSocketTransportOptions {
  url: string
  protocols?: string[]
  /** Max ms to wait for the socket to open before connect() rejects (default
   * 15_000). Guards against environments where neither onopen nor onclose fires
   * on a stalled handshake, which would otherwise hang the reconnect loop. */
  connectTimeout?: number
}

export class WebSocketTransport implements Transport {
  state: TransportState = 'disconnected'

  private ws: WebSocket | null = null
  /** Current relay URL. Readable for channel hint injection. */
  url: string
  private protocols: string[]
  private connectTimeout: number
  /** Frames sent while not yet connected, flushed in order on open. Bounded and
   * scoped to a single connect() lifecycle (cleared on connect/disconnect) so a
   * brief connecting window doesn't silently drop frames, without replaying
   * stale frames across a reconnect. */
  private outbound: ProtocolMessage[] = []

  private messageHandler: ((msg: ProtocolMessage) => void) | null = null
  private closeHandler: ((info?: TransportCloseInfo) => void) | null = null
  private openHandler: (() => void) | null = null
  /** Set true by onerror so the following onclose can flag the close as error-driven. */
  private lastErrored = false

  constructor(options: WebSocketTransportOptions | string) {
    if (typeof options === 'string') {
      this.url = options
      this.protocols = ['walletpair.v1']
      this.connectTimeout = DEFAULT_CONNECT_TIMEOUT
    } else {
      this.url = options.url
      this.protocols = options.protocols ?? ['walletpair.v1']
      this.connectTimeout = options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT
    }
  }

  onMessage(handler: (msg: ProtocolMessage) => void): void {
    this.messageHandler = handler
  }
  onClose(handler: (info?: TransportCloseInfo) => void): void {
    this.closeHandler = handler
  }
  onOpen(handler: () => void): void {
    this.openHandler = handler
  }

  /** Update the relay URL (useful for reconnect to a different relay). */
  setUrl(url: string): void {
    this.url = url
  }

  connect(): Promise<void> {
    // Each connect starts a fresh outbound window — drop anything queued from a
    // previous (failed) attempt so stale frames are never replayed.
    this.outbound = []
    return new Promise<void>((resolve, reject) => {
      this.state = 'connecting'
      const ws = new WebSocket(this.url, this.protocols)

      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        // Neither onopen nor onclose fired in time — tear down and fail so the
        // reconnect loop isn't left hanging on a stalled handshake.
        try {
          ws.onopen = null
          ws.onclose = null
          ws.onerror = null
          ws.close()
        } catch {
          /* ignore */
        }
        this.state = 'disconnected'
        reject(new Error('WebSocket connect timed out'))
      }, this.connectTimeout)
      ;(timer as unknown as { unref?: () => void }).unref?.()

      ws.onopen = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.state = 'connected'
        this.ws = ws
        this.lastErrored = false
        this.flushOutbound()
        this.openHandler?.()
        resolve()
      }

      ws.onmessage = (event: MessageEvent) => {
        if (!this.messageHandler) return
        const data = event.data
        if (typeof data !== 'string' || data.length > MAX_INBOUND_BYTES) return // oversized/binary → drop
        let parsed: unknown
        try {
          parsed = JSON.parse(data)
        } catch {
          return // malformed JSON → drop
        }
        if (!isWireMessage(parsed)) return // wrong shape → drop, never hand to session
        this.messageHandler(parsed)
      }

      ws.onclose = (event: CloseEvent) => {
        if (settled && this.state !== 'connected') return
        clearTimeout(timer)
        const wasConnected = this.state === 'connected'
        const wasError = this.lastErrored
        this.lastErrored = false
        this.state = 'disconnected'
        this.ws = null
        if (wasConnected) {
          // Surface the close code/reason for developer-only disconnect logging.
          // 1006 = abnormal (network/idle drop), 1000 = normal, etc.
          this.closeHandler?.({
            code: event?.code,
            reason: event?.reason || undefined,
            wasError,
          })
        } else if (!settled) {
          settled = true
          reject(new Error('WebSocket connection failed'))
        }
      }

      ws.onerror = () => {
        // The browser fires onerror then onclose; onclose handles reject/cleanup.
        // Flag it so the close can be recorded as error-driven for diagnostics.
        this.lastErrored = true
      }
    })
  }

  send(msg: ProtocolMessage): void {
    if (this.ws && this.state === 'connected') {
      this.ws.send(JSON.stringify(msg))
      return
    }
    // Not connected yet: buffer (bounded) instead of silently dropping, so a
    // frame sent in the brief connecting window survives to the open handler.
    if (this.outbound.length >= MAX_OUTBOUND_QUEUE) this.outbound.shift()
    this.outbound.push(msg)
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
    this.outbound = []
    this.state = 'disconnected'
  }

  private flushOutbound(): void {
    if (this.outbound.length === 0 || !this.ws) return
    const queued = this.outbound
    this.outbound = []
    for (const msg of queued) {
      this.ws.send(JSON.stringify(msg))
    }
  }
}

/** Minimal structural validation of an inbound frame before it reaches a session. */
function isWireMessage(value: unknown): value is ProtocolMessage {
  if (value == null || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  return (
    typeof m.t === 'string' &&
    typeof m.v === 'number' &&
    typeof m.ch === 'string' &&
    typeof m.from === 'string' &&
    typeof m.body === 'object' &&
    m.body !== null
  )
}
