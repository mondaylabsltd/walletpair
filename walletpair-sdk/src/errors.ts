/**
 * Typed errors for WalletPair.
 *
 * The WalletPair protocol rejects requests with *string* codes (e.g.
 * `user_rejected`). EVM dApps, viem, wagmi, and RainbowKit branch on *numeric*
 * EIP-1193 / JSON-RPC codes (e.g. 4001 for "user rejected"). This module
 * provides the `ProviderRpcError` shape those libraries expect and a mapping
 * from WalletPair string codes to numeric ones, so the EVM provider can surface
 * errors dApps actually understand.
 */

/** Standard EIP-1193 provider error codes. */
export const ProviderErrorCode = {
  /** The user rejected the request. */
  USER_REJECTED: 4001,
  /** The requested method/account has not been authorized by the user. */
  UNAUTHORIZED: 4100,
  /** The provider does not support the requested method. */
  UNSUPPORTED_METHOD: 4200,
  /** The provider is disconnected from all chains. */
  DISCONNECTED: 4900,
  /** The provider is disconnected from the requested chain. */
  CHAIN_DISCONNECTED: 4901,
  /** The requested chain has not been added to the wallet (EIP-3326). */
  UNRECOGNIZED_CHAIN: 4902,
} as const

/** Standard JSON-RPC 2.0 error codes used by EVM providers. */
export const RpcErrorCode = {
  INVALID_INPUT: -32000,
  TRANSACTION_REJECTED: -32003,
  METHOD_NOT_SUPPORTED: -32004,
  LIMIT_EXCEEDED: -32005,
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const

/** An EIP-1193 `ProviderRpcError`: an Error carrying a numeric `code` (+ optional `data`). */
export class ProviderRpcError extends Error {
  code: number
  data?: unknown
  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'ProviderRpcError'
    this.code = code
    if (data !== undefined) this.data = data
  }
}

/**
 * Map a WalletPair protocol/sub-protocol error code (string) to a numeric
 * EIP-1193 / JSON-RPC code.
 */
export function walletPairCodeToRpcCode(code: string | undefined): number {
  switch (code) {
    case 'user_rejected':
      return ProviderErrorCode.USER_REJECTED // 4001
    case 'unauthorized':
      return ProviderErrorCode.UNAUTHORIZED // 4100
    case 'unsupported_method':
    case 'unsupported_capability':
      return ProviderErrorCode.UNSUPPORTED_METHOD // 4200
    case 'unsupported_chain':
    case 'chain_not_found':
      return ProviderErrorCode.UNRECOGNIZED_CHAIN // 4902
    case 'disconnected':
      return ProviderErrorCode.DISCONNECTED // 4900
    case 'invalid_params':
      return RpcErrorCode.INVALID_PARAMS // -32602
    case 'rate_limited':
      return RpcErrorCode.LIMIT_EXCEEDED // -32005
    case 'transaction_rejected':
      return RpcErrorCode.TRANSACTION_REJECTED // -32003
    default:
      return RpcErrorCode.INTERNAL_ERROR // -32603
  }
}

/**
 * Normalize any error thrown along the request path into an EIP-1193
 * `ProviderRpcError` with a numeric code:
 *  - already a ProviderRpcError → returned as-is;
 *  - a numeric `code` (e.g. a node-level JSON-RPC revert, or a provider-thrown
 *    4200/4900) → preserved;
 *  - a string `code` (a WalletPair wallet rejection) → mapped to numeric;
 *  - otherwise → -32603 internal error.
 */
export function toProviderRpcError(error: unknown): ProviderRpcError {
  if (error instanceof ProviderRpcError) return error
  const e = error as { code?: unknown; message?: unknown; data?: unknown } | undefined
  const message =
    typeof e?.message === 'string' && e.message.length > 0 ? e.message : 'Request failed'
  const rawCode = e?.code
  if (typeof rawCode === 'number') return new ProviderRpcError(rawCode, message, e?.data)
  if (typeof rawCode === 'string') {
    // A wallet may serialize a numeric EIP-1193 code as a string (e.g. the EVM
    // sub-protocol's `session.reject(id, String(code))` turns 4902 into "4902").
    // Preserve those; otherwise map the symbolic WalletPair code.
    if (/^-?\d+$/.test(rawCode)) return new ProviderRpcError(Number(rawCode), message, e?.data)
    return new ProviderRpcError(walletPairCodeToRpcCode(rawCode), message, e?.data)
  }
  return new ProviderRpcError(RpcErrorCode.INTERNAL_ERROR, message, e?.data)
}
