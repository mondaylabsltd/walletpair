// Labels for the side panel.

import { SOLANA_CLUSTERS } from './walletpair/networks/solana';
import { TRON_NETWORKS } from './walletpair/networks/tron';

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

export const NAMESPACE_NAMES: Record<string, string> = { eip155: 'EVM', tron: 'TRON', solana: 'Solana' };

/** `eip155:137` → `Polygon`, `tron:3448148188` → `TRON Nile`, `solana:…` → `Solana Devnet`. */
export function chainName(chain: string): string {
  const [namespace, reference] = chain.split(':');
  if (namespace === 'eip155') return EVM_CHAINS[reference] ?? `Chain ${reference}`;
  if (namespace === 'tron') {
    const network = TRON_NETWORKS.find((n) => n.chain === chain);
    return network ? (network.name === 'Mainnet' ? 'TRON' : `TRON ${network.name}`) : `TRON ${reference}`;
  }
  if (namespace === 'solana') {
    const cluster = SOLANA_CLUSTERS.find((c) => c.chain === chain);
    const name = cluster?.standard.slice('solana:'.length) ?? reference.slice(0, 8);
    return name === 'mainnet' ? 'Solana' : `Solana ${name[0].toUpperCase()}${name.slice(1)}`;
  }
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
  tron_signTransaction: 'Sign transaction',
  tron_signMessage: 'Sign message',
  tron_switchChain: 'Switch network',
  solana_signTransactions: 'Sign transaction',
  solana_signAndSendTransaction: 'Send transaction',
  solana_signMessage: 'Sign message',
};

export function methodName(method: string): string {
  return METHOD_NAMES[method] ?? method;
}
