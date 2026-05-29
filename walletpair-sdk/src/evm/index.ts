/**
 * EVM-specific exports for WalletPair SDK.
 *
 * Provides EIP-1193 provider and wagmi connector for Ethereum/EVM networks.
 */

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
