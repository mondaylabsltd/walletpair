import { STORAGE_KEYS, DEFAULT_RELAY_URL } from './constants';
import type { ConnectedWallet, ExtensionSettings, OriginPermission } from './types';

const defaults: ExtensionSettings = {
  relayUrl: DEFAULT_RELAY_URL,
  autoConnect: true,
  enabledChains: ['eip155:1', 'eip155:137', 'eip155:42161', 'eip155:10', 'eip155:8453'],
  rpcUrls: {
    1: 'https://eth.llamarpc.com',
    10: 'https://mainnet.optimism.io',
    56: 'https://bsc-dataseed.binance.org',
    137: 'https://polygon-rpc.com',
    42161: 'https://arb1.arbitrum.io/rpc',
    8453: 'https://mainnet.base.org',
    43114: 'https://api.avax.network/ext/bc/C/rpc',
  },
};

/** Get extension settings from chrome.storage.local */
export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...defaults, ...result[STORAGE_KEYS.SETTINGS] };
}

/** Save extension settings */
export async function saveSettings(settings: Partial<ExtensionSettings>): Promise<void> {
  const current = await getSettings();
  await chrome.storage.local.set({
    [STORAGE_KEYS.SETTINGS]: { ...current, ...settings },
  });
}

/** Get saved session state (for reconnection) */
export async function getSessionState(): Promise<string | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SESSION_STATE);
  return result[STORAGE_KEYS.SESSION_STATE] ?? null;
}

/** Save session state */
export async function saveSessionState(state: string | null): Promise<void> {
  if (state) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SESSION_STATE]: state });
  } else {
    await chrome.storage.local.remove(STORAGE_KEYS.SESSION_STATE);
  }
}

/** Get connected wallet info */
export async function getConnectedWallet(): Promise<ConnectedWallet | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.CONNECTED_WALLET);
  return result[STORAGE_KEYS.CONNECTED_WALLET] ?? null;
}

/** Save connected wallet info */
export async function saveConnectedWallet(wallet: ConnectedWallet | null): Promise<void> {
  if (wallet) {
    await chrome.storage.local.set({ [STORAGE_KEYS.CONNECTED_WALLET]: wallet });
  } else {
    await chrome.storage.local.remove(STORAGE_KEYS.CONNECTED_WALLET);
  }
}

// ── Per-origin permissions ──────────────────────────────────────────────

/** Get all origin permissions */
export async function getPermissions(): Promise<Record<string, OriginPermission>> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.PERMISSIONS);
  return result[STORAGE_KEYS.PERMISSIONS] ?? {};
}

/** Grant permission for an origin */
export async function grantPermission(origin: string): Promise<void> {
  const perms = await getPermissions();
  perms[origin] = { origin, granted: true, grantedAt: Date.now() };
  await chrome.storage.local.set({ [STORAGE_KEYS.PERMISSIONS]: perms });
}

/** Revoke permission for an origin */
export async function revokePermission(origin: string): Promise<void> {
  const perms = await getPermissions();
  delete perms[origin];
  await chrome.storage.local.set({ [STORAGE_KEYS.PERMISSIONS]: perms });
}

/** Check if an origin is permitted */
export async function isPermitted(origin: string): Promise<boolean> {
  const perms = await getPermissions();
  return perms[origin]?.granted === true;
}

// ── Session timestamp ─────────────────────────────────────────────────

/** Save the timestamp when the session entered connected state */
export async function saveConnectedAt(ts: number | null): Promise<void> {
  if (ts) {
    await chrome.storage.local.set({ [STORAGE_KEYS.CONNECTED_AT]: ts });
  } else {
    await chrome.storage.local.remove(STORAGE_KEYS.CONNECTED_AT);
  }
}

/** Get the timestamp when the session entered connected state */
export async function getConnectedAt(): Promise<number | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.CONNECTED_AT);
  return result[STORAGE_KEYS.CONNECTED_AT] ?? null;
}
