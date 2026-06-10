import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearDisconnectLog,
  getDisconnectLog,
  recordDisconnect,
  setDisconnectLogSink,
  setWalletpairDebugLogging,
} from './disconnect-log.js'
import { isRecoverableCloseReason, PERMANENT_CLOSE_REASONS } from './types.js'

afterEach(() => {
  clearDisconnectLog()
  setDisconnectLogSink(null)
  setWalletpairDebugLogging(false)
})

describe('disconnect-log ring buffer', () => {
  it('records entries with a timestamp and returns a snapshot', () => {
    recordDisconnect({
      side: 'dapp',
      kind: 'terminate',
      reason: 'rate_limited',
      phase: 'connected',
    })
    const log = getDisconnectLog()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      side: 'dapp',
      kind: 'terminate',
      reason: 'rate_limited',
      phase: 'connected',
    })
    expect(typeof log[0]?.ts).toBe('number')
  })

  it('caps the buffer at 50 entries (keeps the newest)', () => {
    for (let i = 0; i < 60; i++) {
      recordDisconnect({ side: 'wallet', kind: 'transport_close', code: i })
    }
    const log = getDisconnectLog()
    expect(log).toHaveLength(50)
    // Oldest 10 dropped: first kept entry is code 10, last is 59.
    expect(log[0]?.code).toBe(10)
    expect(log[log.length - 1]?.code).toBe(59)
  })

  it('clearDisconnectLog empties the buffer', () => {
    recordDisconnect({ side: 'dapp', kind: 'session_close', reason: 'normal' })
    clearDisconnectLog()
    expect(getDisconnectLog()).toHaveLength(0)
  })

  it('returns a copy, not the live buffer', () => {
    recordDisconnect({ side: 'dapp', kind: 'terminate', reason: 'timeout' })
    const snap = getDisconnectLog()
    snap.push({ ts: 0, side: 'wallet', kind: 'terminate' })
    expect(getDisconnectLog()).toHaveLength(1)
  })
})

describe('disconnect-log sink', () => {
  it('forwards every entry to a registered sink', () => {
    const sink = vi.fn()
    setDisconnectLogSink(sink)
    recordDisconnect({ side: 'wallet', kind: 'terminate', reason: 'channel_not_found' })
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink.mock.calls[0]?.[0]).toMatchObject({ reason: 'channel_not_found' })
  })

  it('swallows sink exceptions so the connection path is never broken', () => {
    setDisconnectLogSink(() => {
      throw new Error('sink blew up')
    })
    expect(() =>
      recordDisconnect({ side: 'dapp', kind: 'terminate', reason: 'rate_limited' }),
    ).not.toThrow()
    // Entry is still recorded in the ring buffer.
    expect(getDisconnectLog()).toHaveLength(1)
  })
})

describe('disconnect-log console gating', () => {
  it('does not write to console.debug by default', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    recordDisconnect({ side: 'dapp', kind: 'terminate', reason: 'rate_limited' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('writes to console.debug when debug logging is enabled', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    setWalletpairDebugLogging(true)
    recordDisconnect({ side: 'dapp', kind: 'terminate', reason: 'rate_limited' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]?.[0]).toContain('[walletpair][disconnect]')
    spy.mockRestore()
  })
})

describe('isRecoverableCloseReason', () => {
  it.each([
    'normal',
    'user_rejected',
    'unsupported_capability',
    'unsupported_version',
    'already_connected',
    'decryption_failed',
  ])('treats %s as permanent (not recoverable)', (reason) => {
    expect(isRecoverableCloseReason(reason)).toBe(false)
  })

  it.each([
    'rate_limited',
    'channel_not_found',
    'payload_too_large',
    'timeout',
    'invalid_state',
    'invalid_role',
    'protocol_error',
    'channel_exists',
  ])('treats %s as recoverable', (reason) => {
    expect(isRecoverableCloseReason(reason)).toBe(true)
  })

  it('treats undefined / unknown reasons as recoverable (fail safe)', () => {
    expect(isRecoverableCloseReason(undefined)).toBe(true)
    expect(isRecoverableCloseReason('some_future_reason')).toBe(true)
  })

  it('PERMANENT_CLOSE_REASONS and isRecoverableCloseReason agree', () => {
    for (const reason of PERMANENT_CLOSE_REASONS) {
      expect(isRecoverableCloseReason(reason)).toBe(false)
    }
  })
})
