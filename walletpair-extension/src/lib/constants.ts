/** Default WalletPair relay server */
export const DEFAULT_RELAY_URL = 'wss://relay.walletpair.org/v1';

/** Extension display name for EIP-6963 */
export const EXTENSION_NAME = 'WalletPair';

/** Reverse domain name for EIP-6963 */
export const EXTENSION_RDNS = 'org.walletpair.extension';

/** Unique UUID for EIP-6963 provider (stable across sessions) */
export const PROVIDER_UUID = 'e3a10000-7770-4270-8000-000077700001';

/** Message channel name for content script <-> injected script communication */
export const MSG_CHANNEL = 'walletpair-ext';

/** Chrome storage keys */
export const STORAGE_KEYS = {
  RELAY_URL: 'relayUrl',
  SESSION_STATE: 'sessionState',
  CONNECTED_WALLET: 'connectedWallet',
  SETTINGS: 'settings',
} as const;
