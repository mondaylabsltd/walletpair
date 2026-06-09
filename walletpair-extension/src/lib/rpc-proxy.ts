/**
 * RPC proxy logic — backward-compatible pass-through.
 *
 * The actual implementation now lives in protocols/ethereum/rpc-proxy.ts.
 * This module delegates to the protocol handler so existing imports
 * (background.ts, test files) continue to work without changes.
 */
import { getHandler } from './protocols/registry';
import { getSettings } from './storage';

// Re-export constants for backward compatibility
export { DEFAULT_RPC } from './protocols/ethereum/rpc-proxy';
export { READ_ONLY_METHODS } from './protocols/ethereum/methods';

/**
 * Proxy an RPC call to a public node for the given chain.
 * Priority: user settings > wallet-provided > built-in defaults.
 */
export async function proxyRpcCall(
  chainId: number,
  method: string,
  params: unknown,
  walletRpcUrls?: Record<string, string>,
): Promise<unknown> {
  const handler = getHandler('ethereum');
  const settings = await getSettings();
  // Merge: wallet-provided (CAIP-2 keyed) → convert to numeric, then overlay user settings
  const merged: Record<string, string> = {};
  if (walletRpcUrls) {
    for (const [caip2, url] of Object.entries(walletRpcUrls)) {
      // "eip155:1" → "1"
      const parts = caip2.split(':');
      const numericId = parts[1] ?? parts[0];
      merged[numericId] = url;
    }
  }
  // User settings override wallet-provided
  Object.assign(merged, settings.rpcUrls ?? {});
  return handler.proxyReadOnly(String(chainId), method, params, merged);
}
