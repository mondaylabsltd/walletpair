/**
 * Protocol registry — lookup handlers by name or namespace.
 */
import type { ProtocolHandler } from './types';
import { ethereumHandler } from './ethereum/handler';

const handlers = new Map<string, ProtocolHandler>();
handlers.set('ethereum', ethereumHandler);

/** Get a protocol handler by name. Throws if unknown. */
export function getHandler(protocolName: string): ProtocolHandler {
  const h = handlers.get(protocolName);
  if (!h) throw new Error(`Unknown protocol: ${protocolName}`);
  return h;
}

/** Get a protocol handler by its CAIP-2 namespace. */
export function getHandlerByNamespace(ns: string): ProtocolHandler | undefined {
  for (const h of handlers.values()) {
    if (h.namespace === ns) return h;
  }
  return undefined;
}

/** Get all registered protocol handlers. */
export function getAllHandlers(): ProtocolHandler[] {
  return [...handlers.values()];
}

/** Detect protocol from a chain identifier string. */
export function detectProtocol(chainIdentifier: string): string {
  if (chainIdentifier.startsWith('eip155:')) return 'ethereum';
  if (chainIdentifier.startsWith('solana:')) return 'solana';
  if (chainIdentifier.startsWith('sui:')) return 'sui';
  if (chainIdentifier.startsWith('cosmos:')) return 'cosmos';
  if (chainIdentifier.startsWith('bip122:')) return 'bitcoin';
  if (/^\d+$/.test(chainIdentifier)) return 'ethereum'; // bare numeric = EVM
  return 'ethereum'; // default
}
