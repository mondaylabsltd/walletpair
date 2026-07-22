/**
 * Pure utility functions for the confirmation popup.
 * Extracted from confirm/App.svelte for testability.
 *
 * Generic (chain-agnostic) utilities are defined here directly.
 * EVM-specific formatters delegate to the protocol handler so they
 * work correctly when multi-chain support is added.
 */
import { getHandler } from './protocols/registry';

// Re-export formatTypedData from the EVM formatters (EVM-specific but imported directly where needed)
export { formatTypedData } from './protocols/ethereum/formatters';

// ── Protocol-aware formatters (delegate to handler) ────────────────────

export function formatMethod(m: string, protocol = 'ethereum'): string {
  return getHandler(protocol).formatMethodName(m);
}

export function formatValue(wei: string | undefined, chainRef = '1', protocol = 'ethereum'): string {
  return getHandler(protocol).formatDisplayValue(wei ?? '', chainRef);
}

export function chainName(chainId: number, protocol = 'ethereum'): string {
  return getHandler(protocol).getChainName(String(chainId));
}

// ── Generic (chain-agnostic) utilities ─────────────────────────────────

export function shortenAddr(addr: string | undefined): string {
  if (!addr) return 'Unknown';
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

export function truncateHex(hex: string | undefined, max = 120): string {
  if (!hex) return '';
  if (hex.length <= max) return hex;
  return hex.slice(0, max) + '\u2026';
}

export function tryDecodeHex(s: string | undefined): string {
  if (!s) return '';
  if (!s.startsWith('0x')) return s;
  try {
    const hex = s.slice(2);
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return s;
  }
}
