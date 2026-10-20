/**
 * Read-only EVM node methods the extension answers from an RPC endpoint
 * (spec/networks/evm.md §3). They never cross WalletPair, and anything not
 * listed here is never forwarded to a node.
 */
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
