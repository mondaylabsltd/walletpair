/**
 * EVM RPC proxy — sends read-only JSON-RPC calls to public nodes.
 *
 * Moved from src/lib/rpc-proxy.ts into the protocol layer.
 */

/**
 * Default RPC endpoints per chain for read-only method proxying.
 * The bridge itself is chain-agnostic — it forwards any chain the wallet supports.
 * These RPCs are only used for `eth_call`, `eth_getBalance`, etc. so the dApp
 * doesn't need its own RPC provider.
 */
export const DEFAULT_RPC: Record<number, string> = {
  1: 'https://eth.llamarpc.com',
  10: 'https://mainnet.optimism.io',
  56: 'https://bsc-dataseed.binance.org',
  100: 'https://rpc.gnosis.gateway.fm',
  137: 'https://polygon-rpc.com',
  250: 'https://rpc.ftm.tools',
  324: 'https://mainnet.era.zksync.io',
  8453: 'https://mainnet.base.org',
  42161: 'https://arb1.arbitrum.io/rpc',
  42170: 'https://nova.arbitrum.io/rpc',
  43114: 'https://api.avax.network/ext/bc/C/rpc',
  59144: 'https://rpc.linea.build',
  534352: 'https://rpc.scroll.io',
  7777777: 'https://rpc.zora.energy',
};

/** RPC proxy timeout (30 seconds) */
const RPC_TIMEOUT_MS = 30_000;

/** Max RPC response size (2 MB) */
const RPC_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/**
 * Proxy an RPC call to a public node for the given chain.
 *
 * @param chainRef - Numeric chain ID as a string (e.g., '1', '137')
 * @param method - JSON-RPC method name
 * @param params - JSON-RPC params
 * @param customRpcUrls - User-configured RPC URLs keyed by chain ID (string or number keys)
 */
export async function evmProxyRpcCall(
  chainRef: string,
  method: string,
  params: unknown,
  customRpcUrls: Record<string, string>,
): Promise<unknown> {
  const chainId = parseInt(chainRef, 10);
  const rpcUrl = customRpcUrls[chainId] ?? customRpcUrls[chainRef] ?? DEFAULT_RPC[chainId];
  if (!rpcUrl) {
    throw Object.assign(new Error(`No RPC URL configured for chain ${chainId}`), { code: -32601 });
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method,
    params: params ?? [],
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('RPC request timed out'), { code: -32603 });
    }
    throw Object.assign(new Error(err.message ?? 'RPC fetch failed'), { code: -32603 });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw Object.assign(new Error(`RPC HTTP ${res.status}: ${res.statusText}`), { code: -32603 });
  }

  // Check content-length if available
  const contentLength = res.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > RPC_MAX_RESPONSE_BYTES) {
    throw Object.assign(new Error('RPC response too large'), { code: -32603 });
  }

  const text = await res.text();
  if (text.length > RPC_MAX_RESPONSE_BYTES) {
    throw Object.assign(new Error('RPC response too large'), { code: -32603 });
  }

  const json = JSON.parse(text);
  if (json.error) {
    throw Object.assign(new Error(json.error.message ?? 'RPC error'), { code: json.error.code ?? -32603 });
  }
  return json.result;
}
