# 07 — Maintenance Guide

## High-risk zones (change with extreme care)

### The nonce invariant
`walletpair-sdk/src/crypto.ts` `sealPayload` derives the ChaCha20-Poly1305 nonce as `HMAC-SHA256(dirKey, uint32_be(seq))[0:12]`. **The single most dangerous change in the codebase is anything that could reuse a `(directional key, seq)` pair.** Rules when touching sessions/persistence:
- The send seq is captured synchronously in `nextSendSeq()` and the snapshot is persisted **write-ahead** (before the sealed frame is sent).
- Persistence writes are **serialized through a FIFO chain** (`persistSnapshot()` in `dapp-session.ts` / `wallet-session.ts`) so a lower-seq snapshot can never be durably written after a higher-seq one — this is what prevents a crash+restore from regressing the seq and reusing a nonce under a reordering async backend. **Do not** revert this to a direct `persistence.save(...)`; the regression test `sequence-validation.test.ts` "serializes async persistence writes…" guards it (it fails with `maxConcurrent=2` on the naive version).
- If you add a new field to the snapshot, keep `serialize()` synchronous and pure. Never make the send path resolve before its snapshot is durable.
- Any `SessionPersistence` you write for a remote/KV backend must not lose or reorder writes; the SDK now tolerates reordering, but silent data loss would still break resume.

### Relay channel accounting
`walletpair-websocket-relay/src/relay.rs` `handle_create`. Both `active_channels` (gauge) and the sharded `total_channels` (capacity) counter must **net to zero on a replacement** (re-create of an existing channel). The invariant: `remove_channel` decrements `active_channels` and the create increments it (net 0); the result must be `ProcessResult::OkReplaced` (not `OkCreated`) so `session.rs` does **not** `inc_total`. Regression: `repeated_recreate_does_not_drift_capacity_counters`. If you add a new replacement path, set `replaced = true` and do **not** add a compensating `active_channels.inc()`.

### Read-only RPC proxying
`walletpair-extension/src/lib/protocols/ethereum/rpc-proxy.ts` and `lib/rpc-proxy.ts`. Rules:
- **Untrusted** URLs (wallet-supplied, registry-discovered) must pass `isSafeRpcUrl()` (HTTPS + no loopback/private/link-local/metadata). **User-configured** settings URLs are intentionally *not* guarded (localhost dev nodes are legitimate).
- An RPC-level answer (JSON-RPC error, HTTP 4xx, oversized) must **propagate with its real code**; only transport failures (network/timeout/5xx/429) may fall back to discovery. Don't collapse these back into a generic error — that was the masking bug.

### Extension consent
`walletpair-extension/src/entrypoints/background.ts`. The permission model has a known gap (see [08](08-open-issues.md) #10): granting is bound to the session, not to a user-approved origin, and any origin calling `eth_requestAccounts` while connected is auto-granted at `:685`. If you touch `flushDeferredRequests`, `grantPermission`, or `broadcastEvent`, be aware you are in the middle of an unfinished consent redesign — do not widen access.

### EVM method mapping
`walletpair-sdk/src/evm/eip1193.ts` `mapRequest`. `personal_sign` now **rejects** malformed-hex/non-UTF-8 payloads (they can't round-trip through the UTF-8-only `wallet_signMessage`). Preserve that; do not reintroduce lossy `TextDecoder` decoding. Active-chain sync is still missing (#9) — if you add it, it likely requires a protocol/handshake change and must be tested against real mobile wallets.

## Test strategy

- **SDK** (Vitest, 714 tests): unit crypto + directional/hardening, canonical-JSON vectors, sequence-validation (replay + persistence), integration, `security.test.ts` (AAD/ciphertext/key tamper), adversarial suites (malicious relay/dapp/wallet), spec-compliance (crypto vectors, state machine, message format). **Add a test for every protocol invariant you touch.**
- **Extension** (Vitest 253 + Puppeteer E2E): provider EIP-1193/6963 compliance, content bridge, rpc-proxy, background logic. E2E needs the demo dApp at `localhost:3000`.
- **Rust relay** (cargo, 216): unit + integration (`tests/integration.rs`) + reliability (`tests/reliability.rs`) + 3 cargo-fuzz targets.
- **CF worker** (vitest-pool-workers): channel/e2e/protocol + a **live** suite against prod. Can't run in a network-restricted sandbox; runs in CI.
- **Website**: unit (currently 0 test files) + Playwright E2E (hits prod relay).

### The regression-test discipline used in this audit
For each bug fix, write a test that **fails on the current (buggy) code first**, then apply the fix and confirm it passes. Two fixes here (SDK FIFO, Rust drift) were validated exactly this way. Don't trust a green test you never saw fail.

## Safe-change checklist
1. Reproduce the issue with a failing test.
2. Make the smallest change; keep the diff reviewable (avoid unrelated `cargo fmt`/formatter churn — it drowns the real change).
3. Run the package's full gate (`tsc`/`svelte-check` + `vitest`/`cargo test` + `clippy`).
4. For anything touching crypto, sessions, persistence, or the relay state machine, also run the adversarial/spec-compliance suites.
5. Update the affected doc in `docs/project-takeover/`.
