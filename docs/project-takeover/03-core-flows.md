# 03 — Core Flows

File:line references are against baseline `8fafb89`; line numbers shift as code evolves — search by symbol.

## Flow A — Pairing (dApp ⇄ wallet over the relay)

1. **wagmi connector** `walletPair()` (`walletpair-sdk/src/evm/wagmi.ts`) builds a `CreateConnectorFn`; `connect()` constructs a `WalletPairProvider` + `DAppSession`, adapting wagmi `config.storage` to `SessionPersistence` under key `walletPair.session`.
2. **Provider/session** — `new WalletPairProvider` (`evm/eip1193.ts`) wraps a `DAppSession` (`dapp-session.ts:68`).
3. **create** — `DAppSession.createPairing()` opens the WebSocket (`ws-transport.ts`), sends `create` with the dApp pubkey, receives `ready.waiting`, and returns a pairing URI. State `idle → waiting`.
4. **QR / join** — wallet parses the URI (`WalletSession.prepareJoin`), derives keys, sends a `join` carrying a `sealed_join` (encrypted capabilities+meta). Relay forwards `join` to the dApp.
5. **Handshake** — dApp unseals `sealed_join` (`dapp-session.ts` join handler), validates capability shape, derives directional keys, and **auto-accepts** after verification. Both sides compute the session fingerprint; the user can compare.
6. **connected** — relay sends `ready.connected` to both; each side asserts the `remote` pubkey equals the paired peer, else closes. State `waiting → pending_accept → connected`.

## Flow B — Signing request/response

1. dApp calls `provider.request({ method })` → `WalletPairProvider` maps it to a WalletPair EVM method (`eip1193.ts mapRequest`), e.g. `personal_sign → wallet_signMessage`.
2. `DAppSession.request()` (`dapp-session.ts:286`) allocates a monotonic send seq via `nextSendSeq()` (`:887`), **persists the snapshot write-ahead** (`persistSnapshot()` `:907`, now a serialized FIFO chain), then seals and sends `req`.
3. Relay forwards the opaque `req` to the wallet. Wallet unseals, checks its **idempotency cache** (`wallet-session.ts`, keyed by request id + `sha256(params)`), prompts the user, signs, seals a `res`, relay forwards it back.
4. dApp validates the inbound seq is strictly greater than `recvSeq`, persists `recvSeq` before resolving, unseals, and resolves the request promise.
5. Events (`evt`, e.g. `accountsChanged`/`chainChanged`) follow the same sealed path wallet→dApp.

## Flow C — Reconnect / session resume

- Requires durable `SessionPersistence` on **both** peers. On disconnect the SDK re-runs create/join/accept on the **same channel** (relay is stateless).
- Backoff `[1,2,5,10,30]s ±30%` jitter, capped by `maxReconnectAttempts` (10) and `maxReconnectDurationMs` (5 min); an app-level heartbeat pings every 20s and forces reconnect if no pong in 10s (half-open TCP detection).
- On reconnect the dApp **re-seals every still-pending request** with a fresh seq but byte-identical id+params, so the wallet's idempotency cache dedups it.
- If persistence is missing/corrupt, the peer **must start a fresh pairing** rather than reconnect (sequence counters must survive process death, or nonce safety is void).

## Flow D — Extension bridge (page ⇄ content ⇄ background ⇄ wallet)

`walletpair-extension`:
1. Injected provider (`entrypoints/…/provider`) exposes `window.ethereum`/`window.walletpair` (EIP-1193 + EIP-6963) to the page.
2. Content script relays `window.postMessage` ↔ `chrome.runtime` to the background service worker.
3. Background (`entrypoints/background.ts`) owns the `DAppSession`, routes read-only EVM calls to `proxyRpcCall` (`lib/rpc-proxy.ts` → `protocols/ethereum/rpc-proxy.ts`) and wallet methods over the relay, and manages per-origin permissions (`lib/storage.ts`).
4. Wallet events are broadcast only to **permitted** origins (`broadcastEvent`, fail-closed).

## Key business rules & invariants

- **Nonce safety** (highest-stakes): the ChaCha20-Poly1305 nonce is derived solely from `(directional key, send seq)`. A directional seq must **never** be reused. This depends on the send seq being persisted write-ahead *and never regressing* — now enforced by serializing persistence writes (see [07](07-maintenance-guide.md#the-nonce-invariant)).
- **Replay defense**: inbound seq must be strictly greater than the stored `recvSeq`; equal/lesser is dropped.
- **Role enforcement**: the relay rejects a wallet sending `accept`/`req`, a dApp sending `res`/`evt`, and any message on the wrong channel or before `connected`.
- **Channel capacity**: relays cap concurrent channels; the Rust relay's counter must net to zero across re-create/reconnect (fixed — see [04](04-production-readiness.md)).
- **Read-only RPC**: only the `READ_ONLY_METHODS` set is proxied to public nodes; wallet-interaction methods always go to the wallet. Untrusted RPC URLs are SSRF-guarded.
- **Permission gating**: wallet events reach only origins the user authorized. (The *granting* model has a known gap — see [08](08-open-issues.md).)
