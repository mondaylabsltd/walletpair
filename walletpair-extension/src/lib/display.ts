// Labels for the side panel.

const EVM_CHAINS: Record<string, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  56: 'BNB Chain',
  100: 'Gnosis',
  137: 'Polygon',
  324: 'zkSync',
  8453: 'Base',
  42161: 'Arbitrum',
  43114: 'Avalanche',
  59144: 'Linea',
  534352: 'Scroll',
  11155111: 'Sepolia',
};

export const NAMESPACE_NAMES: Record<string, string> = { eip155: 'EVM' };

/** `eip155:137` → `Polygon`. */
export function chainName(chain: string): string {
  const [namespace, reference] = chain.split(':');
  if (namespace === 'eip155') return EVM_CHAINS[reference] ?? `Chain ${reference}`;
  return chain;
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

const METHOD_NAMES: Record<string, string> = {
  personal_sign: 'Sign message',
  eth_signTypedData_v4: 'Sign typed data',
  eth_sendTransaction: 'Send transaction',
  wallet_sendCalls: 'Send calls',
  wallet_switchEthereumChain: 'Switch network',
  wallet_addEthereumChain: 'Add network',
  wallet_getCallsStatus: 'Call status',
  wallet_getCapabilities: 'Capabilities',
};

export function methodName(method: string): string {
  return METHOD_NAMES[method] ?? method;
}
