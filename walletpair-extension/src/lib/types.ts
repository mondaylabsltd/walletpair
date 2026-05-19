/** EIP-1193 request arguments */
export interface EIP1193Request {
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

/** Wallet connection info stored in extension */
export interface ConnectedWallet {
  address: string;
  chainId: number;
  name?: string;
  icon?: string;
}

/** Extension settings */
export interface ExtensionSettings {
  relayUrl: string;
  autoConnect: boolean;
  enabledChains: string[];
  rpcUrls: Record<number, string>;
}

/** Message types between injected script <-> content script */
export type InjectMessage =
  | { type: 'wp-request'; id: string; payload: EIP1193Request }
  | { type: 'wp-response'; id: string; result?: unknown; error?: { code: number; message: string } }
  | { type: 'wp-event'; event: string; data: unknown }
  | { type: 'wp-provider-ready' };

/** Message types between content script <-> background */
export type BackgroundMessage =
  | { action: 'rpc-request'; id: string; payload: EIP1193Request; origin: string }
  | { action: 'rpc-response'; id: string; result?: unknown; error?: { code: number; message: string } }
  | { action: 'get-state' }
  | { action: 'start-pairing' }
  | { action: 'accept-wallet' }
  | { action: 'reject-wallet' }
  | { action: 'disconnect' }
  | { action: 'get-pairing-uri' };

/** State shared from background to popup/content */
export interface ExtensionState {
  phase: 'idle' | 'pairing' | 'pending_accept' | 'connected' | 'disconnected' | 'error';
  pairingUri?: string;
  pairingCode?: string;
  wallet?: ConnectedWallet;
  walletMeta?: { name?: string; icon?: string };
  error?: string;
}
