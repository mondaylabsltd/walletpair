/**
 * EVM-specific formatters for the confirmation popup and display.
 *
 * Moved from src/lib/confirm-utils.ts into the protocol layer.
 */

/** Format an EVM method name for human display in the confirmation popup. */
export function formatMethodName(m: string): string {
  switch (m) {
    case 'eth_sendTransaction': return 'Send Transaction';
    case 'eth_signTransaction': return 'Sign Transaction';
    case 'personal_sign': return 'Sign Message';
    case 'eth_signTypedData_v4':
    case 'eth_signTypedData_v3': return 'Sign Typed Data';
    default: return m;
  }
}

/** Format a wei hex value as a human-readable ETH amount. */
export function formatDisplayValue(wei: string | undefined, _chainRef?: string): string {
  if (!wei || wei === '0x0' || wei === '0x') return '0 ETH';
  const val = parseInt(wei, 16) / 1e18;
  return `${val.toFixed(6)} ETH`;
}

/** Get the human-readable chain name for an EVM chain ID. */
export function getChainName(chainRef: string): string {
  const chainId = parseInt(chainRef, 10);
  switch (chainId) {
    case 1: return 'Ethereum';
    case 10: return 'Optimism';
    case 56: return 'BSC';
    case 100: return 'Gnosis';
    case 137: return 'Polygon';
    case 42161: return 'Arbitrum';
    case 8453: return 'Base';
    case 43114: return 'Avalanche';
    default: return `Chain ${chainId}`;
  }
}

/** Format EIP-712 typed data for display. */
export function formatTypedData(params: any): string {
  try {
    const data = typeof params === 'string' ? JSON.parse(params)
      : params?.data ? (typeof params.data === 'string' ? JSON.parse(params.data) : params.data)
      : params?.[1] ? (typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1])
      : params;
    if (data?.domain) {
      return `Domain: ${data.domain.name ?? 'Unknown'}\nType: ${data.primaryType ?? 'Unknown'}`;
    }
    return JSON.stringify(data, null, 2).slice(0, 300);
  } catch {
    return String(params).slice(0, 300);
  }
}
