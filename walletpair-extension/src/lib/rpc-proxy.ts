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

/** Proxy an RPC call to a public node for the given chain */
export async function proxyRpcCall(chainId: number, method: string, params: unknown): Promise<unknown> {
  const handler = getHandler('ethereum');
  const settings = await getSettings();
  return handler.proxyReadOnly(String(chainId), method, params, settings.rpcUrls ?? {});
}
