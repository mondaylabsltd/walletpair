/** Channel ID: 64 lowercase hex characters (32 bytes). */
export type ChannelId = string;

/** Peer ID: base64url-no-pad encoded X25519 public key (32 bytes -> 43 chars). */
export type PeerId = string;

export type Role = "dapp" | "wallet";

export type ChannelState = "none" | "waiting" | "pending_accept" | "connected" | "closed";

/** Stored in WebSocket attachment; survives hibernation. */
export interface WsAttachment {
  role: Role;
  peerId: string;
  channelId: string;
}

/** Persisted channel state (survives hibernation via storage). */
export interface PersistedChannelState {
  state: ChannelState;
  dappPeerId: string;
  walletPeerId: string | null;
  isReconnect: boolean;
  pendingRequests: string[];
}

export interface Env {
  CHANNEL: DurableObjectNamespace;
}

export type CloseReasonString =
  | "normal"
  | "user_rejected"
  | "unsupported_capability"
  | "channel_not_found"
  | "channel_exists"
  | "already_connected"
  | "invalid_state"
  | "invalid_role"
  | "timeout"
  | "rate_limited"
  | "payload_too_large"
  | "protocol_error"
  | "unsupported_version"
  | "decryption_failed";
