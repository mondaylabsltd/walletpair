/**
 * EVM-specific exports for WalletPair SDK.
 *
 * Provides EIP-1193 provider and wagmi connector for Ethereum/EVM networks.
 */

// EIP-1193 error types so dApps can branch on numeric `error.code` (4001 etc.)
export {
  ProviderErrorCode,
  ProviderRpcError,
  RpcErrorCode,
  toProviderRpcError,
  walletPairCodeToRpcCode,
} from '../errors.js'
export {
  type EIP1193Provider,
  type EIP1193ProviderEvents,
  type EIP1193RequestArgs,
  type MethodMapper,
  WalletPairProvider,
  type WalletPairProviderOptions,
} from './eip1193.js'

export {
  type WalletPairConnectorOptions,
  walletPair,
} from './wagmi.js'
