# walletpair-sdk

## 1.1.0

### Minor Changes

- Production-hardening pass for real networks and broader EVM dApp compatibility.

  **Reliability (both sessions, no wire-protocol change):**

  - In-flight requests now survive a transport reconnect: on reconnect the dApp re-seals and re-sends every still-pending request (same id, fresh seq), relying on the wallet's existing idempotency cache, so a brief network blip recovers in sub-second time instead of hanging to the request timeout. Toggle via `resendOnReconnect` (default true).
  - Application-level heartbeat detects dead-but-open connections (mobile network switch, NAT rebind, sleep) and forces a reconnect, instead of waiting minutes for the OS to surface a close. Configurable via `heartbeatInterval` (default 20s) / `heartbeatTimeout` (default 10s); set interval to 0 to disable.
  - Pending requests are rejected immediately (and their timers cleared) on an inbound `close` / terminal `terminate`, instead of hanging to the timeout.
  - Auto-reconnect is now bounded: it gives up after `maxReconnectAttempts` (default 10) or `maxReconnectDurationMs` (default 5 min) — resetting on each successful reconnect — and emits a new `reconnectExhausted` event before closing. Fixed a backoff-reset race and cleared the pending-accept timer on a drop.

  **WebSocket transport:** frames sent during the connecting window are buffered and flushed on open (no longer silently dropped); oversized/malformed inbound frames are validated and dropped before reaching a session; `connect()` now times out (`connectTimeout`, default 15s) so a stalled handshake can't hang the reconnect loop.

  **EVM / EIP-1193:** `eth_signTypedData_v3` is now mapped (previously declared but unmapped → 4200); `eth_sign` is explicitly rejected with 4200 instead of hanging; errors are normalized into `ProviderRpcError` with numeric EIP-1193 codes (e.g. wallet `user_rejected` → 4001) so viem/wagmi branch correctly — new exports `ProviderRpcError`, `ProviderErrorCode`, `RpcErrorCode`, `toProviderRpcError`, `walletPairCodeToRpcCode`.

  **wagmi connector:** `isAuthorized()` is now a pure predicate (checks for a persisted snapshot without mutating/​restoring the live session); session close and reconnect-exhaustion are bridged to the wagmi `disconnect`/`error` emitters.

### Patch Changes

- e0f58e6: EVM provider: stop rejecting `eth_sendTransaction` / `eth_signTransaction` when the transaction omits `chainId`. Some dApps (e.g. PancakeSwap) switch networks first via `wallet_switchEthereumChain` and then send a transaction with no embedded `tx.chainId`, relying on the wallet's active chain — exactly like MetaMask. The provider now fills the missing `tx.chainId` from the current session chain and derives the top-level `chain` param from the resolved id so the wallet always receives a complete, chain-consistent request (`tx.chainId` matches `chain`, per EVM sub-protocol §6.2). When the dApp does embed `tx.chainId`, it is honored and `chain` is derived from it.
- Fix relay connections dying permanently on recoverable `terminate` messages, and add developer-only disconnect diagnostics.

  **Bug:** both `DAppSession` and `WalletSession` treated _every_ relay `terminate` (except one race-condition reason) as an intentional, permanent close — they set `intentionalClose = true`, cleared persistence, and disarmed the auto-reconnect. So when the relay terminated a connection for a _recoverable_ reason — `rate_limited` (e.g. a wagmi/viem dApp filling the 32 pending-request slots by polling read-only RPC), `channel_not_found` (the peer momentarily dropped so the relay couldn't forward), `payload_too_large`, `timeout`, etc. — the session was killed for good with no reconnect, even though it should have recovered. This is the "terminate/close with no reconnect" instability.

  **Fix:** terminate reasons are now classified via `isRecoverableCloseReason()`. Only genuinely terminal reasons (`normal`, `user_rejected`, `unsupported_capability`, `unsupported_version`, `already_connected`, `decryption_failed`) close permanently; everything else (and any unknown/future reason — fail-safe) keeps the session and reconnects with backoff, without wiping persistence. Reconnect scheduling is now idempotent (no stacked timers) and preserves the growing backoff across repeated mid-reconnect terminates so a persistently-rejecting relay can't cause a tight loop.

  **Diagnostics (developer-only, never user-facing):** the WebSocket transport now surfaces the close `code`/`reason` to the session, and disconnects/terminates/closes are recorded into an in-memory ring buffer. Read it with `getDisconnectLog()`, clear with `clearDisconnectLog()`, forward to a host's own dev log with `setDisconnectLogSink()`, and toggle console output with `setWalletpairDebugLogging()` (also auto-enabled via `WALLETPAIR_DEBUG`, `globalThis.__WALLETPAIR_DEBUG__`, or a `walletpair:debug=1` localStorage key). Nothing is emitted as a session event or shown to end users.

  New exports: `getDisconnectLog`, `clearDisconnectLog`, `setDisconnectLogSink`, `setWalletpairDebugLogging`, `isRecoverableCloseReason`, `PERMANENT_CLOSE_REASONS`, and types `DisconnectLogEntry`, `DisconnectKind`, `TransportCloseInfo`. The `Transport.onClose` handler now receives an optional `TransportCloseInfo` argument (backward compatible — existing zero-arg handlers keep working).

## 1.0.10

### Patch Changes

- Increase the dApp-session request timeout to 300s for transaction methods. `eth_sendTransaction` must wait for on-chain confirmation before returning the txHash, and the previous 120s timeout was too short once gas estimation, passkey signing, bundler submission, and receipt polling on slower chains were combined.

## 1.0.9

### Patch Changes

- EVM sub-protocol improvements:

  - Add `wallet_getCallsStatus` (EIP-5792) relay mapping so dApps can poll batch status from the submitting wallet.
  - Handle `wallet_getCapabilities` locally, returning the wallet-advertised `walletCapabilities`.
  - Counterfactual smart-account support: `eth_getCode` for the connected account returns the wallet's `contractBytecode` when the account isn't deployed yet, so dApps detect an EIP-1271 smart contract wallet instead of an EOA.
  - Auto-build a read-only RPC proxy from wallet-provided `rpcUrls` when no explicit `rpcProvider` is supplied (with timeout and response-size limits); unsupported methods now fall through to the wallet over the relay instead of throwing.
  - Pass through `rpcUrls`, `walletCapabilities`, and `contractBytecode` in negotiated capabilities (previously dropped, breaking all three on the dApp side).
  - Fix array-typed JSON-RPC `params` being silently coerced to an object across the relay; arrays now round-trip correctly via `_params`.

## 1.0.8

### Patch Changes

- Add contractBytecode field to Capabilities for counterfactual smart wallet detection via eth_getCode

## 1.0.7

### Patch Changes

- Add EIP-5792 smart wallet support: walletCapabilities field in Capabilities type, wallet_sendCalls request/response mapping in EIP-1193 provider

## 1.0.6

### Patch Changes

- Add rpcUrls to Capabilities for local read-only RPC proxying, and relax tx validation to only require chainId (type/value/data are optional per EIP-1559 dApp conventions)

## 1.0.5

### Patch Changes

- Fix canonicalize CJS/ESM interop and linter cleanups

  - Fix `canonicalize is not a function` error caused by incorrect CJS/ESM default export unwrapping. Use runtime `typeof` check instead of static `.default` access.
  - Fix `secp256k1.Signature.fromBytes` crash in personalSign example — `secp256k1.sign()` already returns a Signature object, no need to call `fromBytes`.
  - Apply linter fixes: non-null assertions replaced with nullish coalescing, hex literal normalization.

## 1.0.3

### Patch Changes

- Make WebSocketTransport.url public for channel hint injection

## 1.0.2

### Patch Changes

- update readme.md

## 1.0.0

### Major Changes

- Initial release of the WalletPair SDK

### Features

- **Core protocol**: X25519 key exchange, HKDF session key derivation, ChaCha20-Poly1305 authenticated encryption
- **DAppSession / WalletSession**: Full session lifecycle — pairing, handshake, request/response, reconnection, and graceful close
- **WebSocket transport**: Auto-reconnect, ping/pong keepalive, configurable relay URL
- **EVM sub-protocol**: EIP-1193 provider (`walletpair-sdk/evm/eip1193`) and Wagmi connector (`walletpair-sdk/evm/wagmi`)
- **BLE transport**: BLE framing utilities and transport layer (`walletpair-sdk/ble`)
- **Security**: Directional session keys, handshake transcript hashing, session fingerprint verification, snapshot signing
- **Typed event emitter**: Type-safe event system for session state changes
- **CAIP-2 chain ID helpers**: `formatChainId`, `parseChainId`, `evmChainId`, `evmNumericChainId`
- **Pairing URI**: `buildPairingUri` / `parsePairingUri` for QR code and deep link flows
