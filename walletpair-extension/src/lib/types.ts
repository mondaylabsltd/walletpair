import type { NamespaceState, Params, RpcError, SessionState, WalletInfo } from './walletpair/protocol';

/** What one site may see: the approved namespaces it was granted. */
export type SiteState = Record<string, NamespaceState>;

/** A call from a page provider to the background, through the content script. */
export type PageCall =
  /** Accounts for a namespace; `silent` never prompts and answers null when not granted. */
  | { op: 'connect'; namespace: string; silent?: boolean }
  /** A Wallet function (spec/networks/*.md §2). */
  | { op: 'call'; method: string; params?: Params }
  /** A read-only EVM node method. */
  | { op: 'rpc'; method: string; params?: unknown }
  /** The site stops seeing a namespace's accounts. The session is unchanged. */
  | { op: 'disconnect'; namespace: string };

/** Window messages between page providers and the content script (`channel: MSG_CHANNEL`). */
export type PageMessage =
  | { channel: string; type: 'hello' }
  | { channel: string; type: 'call'; id: string; call: PageCall }
  | { channel: string; type: 'result'; id: string; result?: unknown; error?: RpcError }
  | { channel: string; type: 'state'; state: SiteState; live: boolean };

/** A page message without its channel tag. */
export type PageMessageBody = PageMessage extends infer M ? (M extends PageMessage ? Omit<M, 'channel'> : never) : never;

/** Port messages, content script → background. */
export type ContentMessage = { kind: 'hello' } | { kind: 'call'; id: string; call: PageCall };

/** Port messages, background → content script. */
export type BackgroundMessage =
  | { kind: 'result'; id: string; result?: unknown; error?: RpcError }
  | { kind: 'state'; state: SiteState; live: boolean };

export type Phase =
  /** No session. */
  | 'idle'
  /** Waiting for a Wallet to scan the invite. */
  | 'pairing'
  /** Paired; the Wallet has not approved (yet, or declined). */
  | 'waiting'
  /** Approved: the session state has at least one namespace. */
  | 'ready';

export interface SiteApproval {
  id: string;
  origin: string;
  namespace: string;
}

export interface PendingCall {
  id: string;
  method: string;
  origin: string;
}

/** What the side panel shows. */
export interface ExtensionState {
  phase: Phase;
  /** The `walletpair:` URI while pairing. */
  uri?: string;
  /** Whether the Wallet is reachable right now. */
  online: boolean;
  /** Another browser or profile opened this session and took it over. */
  replaced: boolean;
  wallet?: WalletInfo;
  state: SessionState;
  /** Why the Wallet did not approve, when it did not. */
  declined: boolean;
  sites: { origin: string; namespaces: string[] }[];
  approvals: SiteApproval[];
  pending: PendingCall[];
  /** The last action that failed, for the side panel to show. */
  error?: string;
}

/** Side panel → background. */
export type UiMessage =
  | { action: 'get-state' }
  | { action: 'pair' }
  | { action: 'reconnect' }
  | { action: 'disconnect' }
  | { action: 'approve-site'; id: string; allow: boolean }
  | { action: 'revoke-site'; origin: string }
  | { action: 'open-panel' };

export interface ExtensionSettings {
  /** PeerConnect relay for new sessions. */
  relayUrl: string;
  /** User-configured EVM RPC endpoints by chain ID. */
  rpcUrls: Record<number, string>;
}

export interface ActivityEntry {
  id: string;
  timestamp: number;
  origin: string;
  method: string;
  namespace: string;
  status: 'pending' | 'success' | 'rejected' | 'error';
  params?: unknown;
  result?: unknown;
  error?: RpcError;
}
