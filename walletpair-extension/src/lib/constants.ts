/** The PeerConnect relay new sessions use unless the user picks another in Settings. */
export const DEFAULT_RELAY_URL = 'wss://relay.peerconnect.dev';

/** How this extension introduces itself in walletpair_connect (spec/core.md §4.1). */
export const DAPP_INFO = {
  name: 'WalletPair Extension',
  url: 'https://walletpair.org',
  icon: 'https://walletpair.org/icon.png',
} as const;

/** The namespaces the extension asks for when it pairs. */
export const NAMESPACES = ['eip155', 'tron', 'solana'];

/** Tags window messages between the page providers and the content script. */
export const MSG_CHANNEL = 'walletpair-ext';

/** Reverse-DNS name in EIP-6963 and TIP-6963 announcements. */
export const EXTENSION_RDNS = 'org.walletpair.extension';

/** chrome.storage.local keys. */
export const STORAGE_KEYS = {
  SETTINGS: 'settings',
  /** The PeerConnect room record: a secret (spec/core.md §2.4). */
  ROOM: 'room',
  /** Rooms being closed, kept until the Wallet has been told. */
  CLOSING: 'closingRooms',
  /** Wallet and session state, so pages get answers while reconnecting. */
  SESSION: 'session',
  /** Ids of calls waiting for the Wallet, cancelled after a restart (spec/core.md §5). */
  PENDING: 'pendingIds',
  /** Per-site approvals: origin → namespaces. */
  SITES: 'sites',
  ACTIVITY: 'activityLog',
} as const;
