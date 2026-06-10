import { describe, expect, it } from 'vitest'
import {
  ProviderErrorCode,
  ProviderRpcError,
  RpcErrorCode,
  toProviderRpcError,
  walletPairCodeToRpcCode,
} from './errors.js'

describe('errors', () => {
  describe('walletPairCodeToRpcCode', () => {
    it.each([
      ['user_rejected', ProviderErrorCode.USER_REJECTED],
      ['unauthorized', ProviderErrorCode.UNAUTHORIZED],
      ['unsupported_method', ProviderErrorCode.UNSUPPORTED_METHOD],
      ['unsupported_capability', ProviderErrorCode.UNSUPPORTED_METHOD],
      ['unsupported_chain', ProviderErrorCode.UNRECOGNIZED_CHAIN],
      ['invalid_params', RpcErrorCode.INVALID_PARAMS],
      ['rate_limited', RpcErrorCode.LIMIT_EXCEEDED],
      ['transaction_rejected', RpcErrorCode.TRANSACTION_REJECTED],
    ])('maps %s → %d', (code, expected) => {
      expect(walletPairCodeToRpcCode(code)).toBe(expected)
    })

    it('maps unknown/undefined codes to internal error', () => {
      expect(walletPairCodeToRpcCode('something_new')).toBe(RpcErrorCode.INTERNAL_ERROR)
      expect(walletPairCodeToRpcCode(undefined)).toBe(RpcErrorCode.INTERNAL_ERROR)
    })
  })

  describe('toProviderRpcError', () => {
    it('returns a ProviderRpcError unchanged', () => {
      const e = new ProviderRpcError(4001, 'rejected')
      expect(toProviderRpcError(e)).toBe(e)
    })

    it('preserves an existing numeric code', () => {
      const out = toProviderRpcError(Object.assign(new Error('reverted'), { code: 3 }))
      expect(out).toBeInstanceOf(ProviderRpcError)
      expect(out.code).toBe(3)
      expect(out.message).toBe('reverted')
    })

    it('maps a string wallet code to a numeric one', () => {
      const out = toProviderRpcError(Object.assign(new Error('denied'), { code: 'user_rejected' }))
      expect(out.code).toBe(4001)
      expect(out.message).toBe('denied')
    })

    it('preserves a numeric code serialized as a string (e.g. "4902")', () => {
      const out = toProviderRpcError(
        Object.assign(new Error('unsupported chain'), { code: '4902' }),
      )
      expect(out.code).toBe(4902)
      expect(out.message).toBe('unsupported chain')
    })

    it('falls back to internal error for an uncoded error', () => {
      expect(toProviderRpcError(new Error('boom')).code).toBe(RpcErrorCode.INTERNAL_ERROR)
    })
  })
})
