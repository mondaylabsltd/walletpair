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
  137: 'https://polygon.drpc.org',
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

/** Fallback discovery timeout (5 seconds per candidate) */
const FALLBACK_TIMEOUT_MS = 5_000;

/** Max RPC response size (2 MB) */
const RPC_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** In-memory cache: chainId → working fallback RPC URL */
const fallbackCache = new Map<number, { url: string; ts: number }>();

/** Cache TTL: 10 minutes */
const FALLBACK_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * An error thrown by `rpcFetch`. `transient` marks failures where the endpoint
 * itself was unreachable (network/timeout/5xx/429) and a different endpoint
 * might succeed. Absent/false means the endpoint answered — a JSON-RPC error,
 * oversized body, malformed JSON, or 4xx — and the answer must not be masked.
 */
interface RpcError extends Error {
  code: number;
  transient?: boolean;
}

/** True when the error means "try another endpoint", false when it is a real answer. */
function isTransient(err: unknown): boolean {
  return (err as RpcError | undefined)?.transient === true;
}

function rpcError(message: string, code: number, transient: boolean): RpcError {
  return Object.assign(new Error(message), { code, transient }) as RpcError;
}

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

  // Try primary RPC first.
  //
  // Fallback discovery only makes sense when the primary endpoint is
  // *unreachable* (network error, timeout, 5xx, 429). A JSON-RPC error
  // (e.g. "execution reverted"), an oversized response, malformed JSON, or a
  // 4xx is the endpoint's real answer — switching endpoints would either mask
  // the true result or hand it to a less-trusted node, so those propagate
  // immediately with their original code/message.
  let primaryError: RpcError | undefined;
  if (rpcUrl) {
    try {
      return await rpcFetch(rpcUrl, method, params);
    } catch (err) {
      if (!isTransient(err)) throw err;
      primaryError = err as RpcError;
      console.warn(`[RPC] Primary RPC unreachable for chain ${chainId}:`, primaryError.message);
    }
  }

  // Try cached fallback
  const cached = fallbackCache.get(chainId);
  if (cached && Date.now() - cached.ts < FALLBACK_CACHE_TTL_MS) {
    try {
      return await rpcFetch(cached.url, method, params);
    } catch (err) {
      if (!isTransient(err)) throw err;
      // Cached fallback unreachable — invalidate and discover new one
      fallbackCache.delete(chainId);
    }
  }

  // Discover a working RPC from ethereum-data API
  const fallbackUrl = await discoverFallbackRpc(chainId);
  if (fallbackUrl) {
    try {
      const result = await rpcFetch(fallbackUrl, method, params);
      // Cache the working URL
      fallbackCache.set(chainId, { url: fallbackUrl, ts: Date.now() });
      return result;
    } catch (err) {
      // An RPC-level error from the discovered node is still a real answer.
      if (!isTransient(err)) throw err;
      primaryError = (err as RpcError) ?? primaryError;
    }
  }

  // Everything reachable failed. Surface the real transport error if we have
  // one, rather than a generic message that discards the original code.
  if (primaryError) throw primaryError;
  throw Object.assign(new Error(`No RPC URL configured for chain ${chainId}`), { code: -32601 });
}

/**
 * Guards an *untrusted* RPC URL (wallet-supplied or registry-discovered) before
 * the extension service worker — which holds broad host permissions — fetches
 * it. Requires HTTPS and rejects literal internal/loopback/link-local/cloud-
 * metadata targets, blocking the direct SSRF vectors.
 *
 * This is intentionally NOT applied to user-configured RPC URLs from settings:
 * a developer may legitimately point the wallet at http://localhost:8545.
 * Full DNS-rebinding protection is not achievable client-side.
 */
export function isSafeRpcUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host === '169.254.169.254') return false; // IMDS cloud metadata

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return false; // this-network, private, loopback
    if (a === 169 && b === 254) return false; // link-local
    if (a === 172 && b >= 16 && b <= 31) return false; // private
    if (a === 192 && b === 168) return false; // private
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  }

  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1);
    if (v6 === '::1' || v6 === '::') return false; // loopback / unspecified
    if (v6.startsWith('fc') || v6.startsWith('fd')) return false; // unique-local
    if (/^fe[89ab]/.test(v6)) return false; // link-local
  }

  return true;
}

// ── Internal helpers ─────────────────────────────────────────────────────

/** Execute a single JSON-RPC fetch against the given URL. */
async function rpcFetch(rpcUrl: string, method: string, params: unknown): Promise<unknown> {
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
    // Network error / timeout: endpoint unreachable → transient, try another.
    if (err.name === 'AbortError') {
      throw rpcError('RPC request timed out', -32603, true);
    }
    throw rpcError(err.message ?? 'RPC fetch failed', -32603, true);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // 5xx / 429 are transient (endpoint down or throttling); 4xx is a real
    // answer from a reachable endpoint and must not be masked by a fallback.
    const transient = res.status >= 500 || res.status === 429;
    throw rpcError(`RPC HTTP ${res.status}: ${res.statusText}`, -32603, transient);
  }

  // Check content-length if available
  const contentLength = res.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > RPC_MAX_RESPONSE_BYTES) {
    throw rpcError('RPC response too large', -32603, false);
  }

  const text = await res.text();
  if (text.length > RPC_MAX_RESPONSE_BYTES) {
    throw rpcError('RPC response too large', -32603, false);
  }

  const json = JSON.parse(text);
  if (json.error) {
    // The endpoint answered with a JSON-RPC error — this is the real result.
    throw rpcError(json.error.message ?? 'RPC error', json.error.code ?? -32603, false);
  }
  return json.result;
}

/**
 * Fetch RPC list from ethereum-data API and find the first working one.
 * Returns the first URL that successfully responds to eth_chainId, or null.
 */
async function discoverFallbackRpc(chainId: number): Promise<string | null> {
  const apiUrl = `https://ethereum-data.awesometools.dev/chains/eip155-${chainId}.json`;

  let urls: string[];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FALLBACK_TIMEOUT_MS);
    const res = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    urls = data.rpc;
    if (!Array.isArray(urls)) return null;
  } catch {
    return null;
  }

  // Filter: safe (HTTPS, non-internal) URLs with no template variables. The
  // registry is untrusted, so every candidate is guarded before we POST to it.
  const candidates = urls.filter((u: string) => !u.includes('${') && isSafeRpcUrl(u));

  // Race: try candidates in parallel batches of 3, return first success
  for (let i = 0; i < candidates.length; i += 3) {
    const batch = candidates.slice(i, i + 3);
    const result = await Promise.any(
      batch.map(async (url) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FALLBACK_TIMEOUT_MS);
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!res.ok) throw new Error('bad status');
          const json = await res.json();
          if (json.error) throw new Error('rpc error');
          return url;
        } catch (err) {
          clearTimeout(timer);
          throw err;
        }
      }),
    ).catch(() => null);

    if (result) return result;
  }

  return null;
}
