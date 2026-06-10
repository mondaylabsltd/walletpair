/**
 * Developer-only disconnect diagnostics.
 *
 * Records *why* a WalletPair relay connection dropped (WebSocket close code,
 * relay `terminate` reason, session phase, whether the SDK will reconnect) into
 * a small in-memory ring buffer so developers can diagnose connection
 * instability after the fact.
 *
 * This is NOT user-facing. Nothing here is surfaced in any session event or UI.
 * Entries are only printed to the console when debug logging is explicitly
 * enabled (`setWalletpairDebugLogging(true)`, a `WALLETPAIR_DEBUG` env var, a
 * `globalThis.__WALLETPAIR_DEBUG__ === true` flag, or a `walletpair:debug=1`
 * localStorage key). Host apps (extension / mobile wallet) can additionally
 * register a sink via `setDisconnectLogSink()` to forward entries into their own
 * developer log without any console output.
 */

export type DisconnectKind =
  /** WebSocket transport closed (carries the WS close `code`). */
  | 'transport_close'
  /** Relay sent an application-level `terminate` message (carries `reason`). */
  | 'terminate'
  /** The SDK itself closed the session (carries the `reason` we passed). */
  | 'session_close'
  /** A reconnect attempt failed to (re)establish the transport. */
  | 'reconnect_failed'

export interface DisconnectLogEntry {
  /** Epoch millis when the event was recorded. */
  ts: number
  /** Which side of the connection logged it. */
  side: 'dapp' | 'wallet'
  kind: DisconnectKind
  /** WebSocket close code, when known (e.g. 1000 normal, 1006 abnormal). */
  code?: number | undefined
  /** Close / terminate reason string, when known. */
  reason?: string | undefined
  /** Session phase at the moment of the event. */
  phase?: string | undefined
  /** Whether the SDK will attempt to auto-reconnect after this event. */
  willReconnect?: boolean | undefined
  /** Channel ID, to correlate entries belonging to the same session. */
  channelId?: string | undefined
}

const RING_SIZE = 50
const ring: DisconnectLogEntry[] = []
let sink: ((entry: DisconnectLogEntry) => void) | null = null
let consoleEnabled = detectDebugFlag()

function detectDebugFlag(): boolean {
  try {
    const g = globalThis as Record<string, unknown>
    if (g.__WALLETPAIR_DEBUG__ === true) return true
    const proc = g.process as { env?: Record<string, string | undefined> } | undefined
    const envFlag = proc?.env?.WALLETPAIR_DEBUG
    if (envFlag === '1' || envFlag === 'true') return true
  } catch {
    /* no global/process access */
  }
  try {
    // Browser / React Native (when a localStorage shim is present).
    const ls = (globalThis as { localStorage?: { getItem(k: string): string | null } }).localStorage
    if (ls && ls.getItem('walletpair:debug') === '1') return true
  } catch {
    /* localStorage unavailable / throws in some sandboxes */
  }
  return false
}

/**
 * Toggle console output of disconnect diagnostics at runtime. The in-memory
 * ring buffer always records regardless of this setting.
 */
export function setWalletpairDebugLogging(enabled: boolean): void {
  consoleEnabled = enabled
}

/**
 * Register a sink that receives every disconnect entry as it is recorded, or
 * `null` to remove it. Lets host apps forward diagnostics into their own
 * developer-only log. The sink must never throw; exceptions are swallowed.
 */
export function setDisconnectLogSink(fn: ((entry: DisconnectLogEntry) => void) | null): void {
  sink = fn
}

/**
 * Record a disconnect / terminate event. Called by the SDK transport and
 * sessions; host code normally only reads via {@link getDisconnectLog}.
 */
export function recordDisconnect(entry: Omit<DisconnectLogEntry, 'ts'>): void {
  const full: DisconnectLogEntry = { ts: Date.now(), ...entry }
  ring.push(full)
  if (ring.length > RING_SIZE) ring.shift()
  if (sink) {
    try {
      sink(full)
    } catch {
      /* sink must not break the connection path */
    }
  }
  if (consoleEnabled) {
    // console.debug keeps this out of normal (info/warn/error) user-visible logs.
    console.debug('[walletpair][disconnect]', JSON.stringify(full))
  }
}

/** Snapshot (newest last) of recent disconnect diagnostics for inspection. */
export function getDisconnectLog(): DisconnectLogEntry[] {
  return ring.slice()
}

/** Clear the in-memory disconnect diagnostics buffer. */
export function clearDisconnectLog(): void {
  ring.length = 0
}
