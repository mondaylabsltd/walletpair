/**
 * EVM method constants — extracted from background.ts, rpc-proxy.ts, and provider-factory.ts.
 *
 * Single source of truth for which methods belong to which category.
 *
 * Unknown methods are never forwarded speculatively. Only WALLET_METHODS and
 * READ_ONLY_METHODS belong to the version-1 Ethereum protocol.
 */

/** Methods that require user confirmation popup before forwarding to wallet */
export const CONFIRMATION_METHODS: ReadonlySet<string> = new Set([
  'eth_sendTransaction',
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v1',
  'eth_signTypedData_v4',
  'eth_signTypedData_v3',
  'wallet_sendCalls',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
]);

/** Methods handled locally in the extension (no relay trip needed) */
export const LOCAL_METHODS: ReadonlySet<string> = new Set([
  'eth_chainId',
  'net_version',
  'eth_accounts',
  'wallet_getPermissions',
]);

/** Read-only methods routed to a public RPC node, NOT the wallet */
export const READ_ONLY_METHODS: ReadonlySet<string> = new Set([
  'web3_clientVersion', 'eth_syncing', 'eth_blockNumber',
  'eth_call', 'eth_estimateGas', 'eth_createAccessList', 'eth_feeHistory',
  'eth_gasPrice', 'eth_maxPriorityFeePerGas',
  'eth_getBalance', 'eth_getCode', 'eth_getStorageAt', 'eth_getProof',
  'eth_getTransactionCount', 'eth_getBlockByHash', 'eth_getBlockByNumber',
  'eth_getBlockTransactionCountByHash', 'eth_getBlockTransactionCountByNumber',
  'eth_getTransactionByHash', 'eth_getTransactionByBlockHashAndIndex',
  'eth_getTransactionByBlockNumberAndIndex', 'eth_getTransactionReceipt',
  'eth_getLogs',
]);

/** Methods whose request must cross the encrypted WalletPair channel. */
export const WALLET_METHODS: ReadonlySet<string> = new Set([
  'eth_requestAccounts',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
  'wallet_requestPermissions',
  'eth_sendTransaction',
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v1',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'wallet_sendCalls',
  'wallet_getCallsStatus',
  'wallet_getCapabilities',
]);

/** Methods that are explicitly unsupported */
export const UNSUPPORTED_METHODS: ReadonlySet<string> = new Set([
  'eth_getEncryptionPublicKey',
  'eth_decrypt',
  'eth_sign',
  'eth_signTransaction',
  'eth_sendRawTransaction',
]);
