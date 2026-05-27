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
// Emitter
export { Emitter } from './emitter.js'
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
  TransportState,
  WalletMeta,
  WalletPhase,
  WalletSessionEvents,
  WalletSessionOptions,
} from './types.js'
// Chain ID helpers (CAIP-2)
export {
  evmChainId,
  evmNumericChainId,
  formatChainId,
  parseChainId,
} from './types.js'
export { WalletSession } from './wallet-session.js'
export type { WebSocketTransportOptions } from './ws-transport.js'
// Transport
export { WebSocketTransport } from './ws-transport.js'
