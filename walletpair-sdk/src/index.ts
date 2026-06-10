/**
 * WalletPair SDK — connect dApps and wallets over the WalletPair protocol.
 *
 * Main entry point re-exports everything needed for both dApp and wallet sides.
 *
 * Subpath exports:
 *   - walletpair-sdk            Core (this file)
 *   - walletpair-sdk/evm        EVM: EIP-1193 provider + wagmi connector
 *   - walletpair-sdk/evm/eip1193  EIP-1193 provider only
 *   - walletpair-sdk/evm/wagmi    Wagmi connector only
 *   - walletpair-sdk/ble        BLE transport + framing utilities
 */

export type { DirectionalSessionKeys, SessionCryptoContext, X25519KeyPair } from './crypto.js'
// Crypto
export {
  b64urlDecode,
  b64urlEncode,
  buildPairingUri,
  bytesToHex,
  canonicalJson,
  computeHandshakeTranscriptHash,
  computeSessionFingerprint,
  computeSharedSecret,
  deriveDirectionalSessionKeys,
  deriveJoinEncryptionKey,
  deriveSessionKey,
  generateChannelId,
  generateX25519KeyPair,
  getPublicKey,
  hexToBytes,
  parsePairingUri,
  sealJoin,
  sealPayload,
  sha256Hex,
  signSnapshot,
  unsealJoin,
  unsealPayload,
  verifySnapshot,
} from './crypto.js'
// Sessions
export { DAppSession } from './dapp-session.js'
// Developer-only disconnect diagnostics (never user-facing)
export type { DisconnectKind, DisconnectLogEntry } from './disconnect-log.js'
export {
  clearDisconnectLog,
  getDisconnectLog,
  setDisconnectLogSink,
  setWalletpairDebugLogging,
} from './disconnect-log.js'
// Emitter
export { Emitter } from './emitter.js'
// Typed errors (EIP-1193 / JSON-RPC numeric codes for dApp consumers)
export {
  ProviderErrorCode,
  ProviderRpcError,
  RpcErrorCode,
  toProviderRpcError,
  walletPairCodeToRpcCode,
} from './errors.js'
// Types
export type {
  AcceptMessage,
  Capabilities,
  CloseMessage,
  CloseReason,
  CreateMessage,
  DAppMeta,
  DAppPhase,
  DAppSessionEvents,
  DAppSessionOptions,
  EventMessage,
  JoinMessage,
  PairingParams,
  PendingRequest,
  PingMessage,
  PongMessage,
  ProtocolMessage,
  ProtocolMessageBase,
  ReadyMessage,
  RequestMessage,
  ResponseMessage,
  SessionPersistence,
  TerminateMessage,
  Transport,
  TransportCloseInfo,
  TransportState,
  WalletMeta,
  WalletPhase,
  WalletSessionEvents,
  WalletSessionOptions,
} from './types.js'
// Chain ID helpers (CAIP-2) + close-reason classification
export {
  evmChainId,
  evmNumericChainId,
  formatChainId,
  isRecoverableCloseReason,
  PERMANENT_CLOSE_REASONS,
  parseChainId,
} from './types.js'
export { WalletSession } from './wallet-session.js'
export type { WebSocketTransportOptions } from './ws-transport.js'
// Transport
export { WebSocketTransport } from './ws-transport.js'
