# 08 — Open Issues

Status as of 2026-07-09 (`8fafb89` + audit fixes). Items fixed in the audit are in [04](04-production-readiness.md); this file tracks what remains. Each item lists the blocking condition and acceptance criteria.

## P1 — resolve before treating the system as GO

### OI-1 · Production relay runs stale code — redeploy + add deploy CI
- **Evidence**: `relay.walletpair.org` answers `/healthz`=200 but `/readyz`,`/metrics`=404 → it is the CF worker; behavior matches the old pending-limit-32 / terminate-on-blip code, while `channel.ts` source is 256 + recoverable-reason (`1f07e77`). Source is correct; prod is behind.
- **Owner condition**: Cloudflare account credentials + confirmation of the `walletpair-relay` worker and `relay.walletpair.org` route.
- **Action**: redeploy per [05](05-deployment-runbook.md#a-cf-worker-relay); add a `wrangler deploy` CI job on merge to `main`.
- **Acceptance**: a `req`-flood no longer terminates at 32; mobile-backgrounding no longer drops the healthy peer; deploy is reproducible from CI, not a laptop.

### OI-2 · EVM provider never syncs the wallet's active chain
- **Evidence**: `eip1193.ts` sets `chainId = options.chainId ?? 1`; `wagmi.ts` uses `params.chainId ?? config.chains[0].id` on connect **and** reconnect; the snapshot carries no chain state; nothing queries the wallet's active chain. Spec §27.2 (EVM binding, active-chain synchronization) makes chain sync a MUST.
- **Impact**: `eth_chainId`/`net_version` return the wrong chain; read-only calls hit the wrong network's RPC; `tx.chainId` autofilled wrong (only the wallet's confirmation UI catches it).
- **Owner condition**: product decision on the mechanism (query active chain on connect vs adopt from first `chainChanged`) **and** real mobile-wallet interop testing — a wrong fix breaks working flows.
- **Acceptance**: after the user switches chains in the wallet and reloads the dApp, `eth_chainId` and read-only calls reflect the wallet's active chain; validated against ≥1 real wallet.

### OI-3 · Two divergent relay implementations claimed at "parity"
- **Evidence**: Rust relay (richer protections, has fuzzing) is not deployed; CF worker (deployed) lacks `/readyz`,`/metrics`, global/per-IP limits. Pending-request limit differs (SDK caps 32; Rust 32; CF source 256; CF prod 32).
- **Owner condition**: decide the **canonical** production relay. Maintaining two with claimed parity is a standing liability.
- **Acceptance**: one relay is designated canonical; the other is either retired or explicitly a reference impl; the four pending-limit values are reconciled.

## P2 — important; controllable with mitigations

### OI-4 · Extension multi-origin consent model
- **Evidence**: `background.ts` — `flushDeferredRequests` re-runs every deferred `eth_requestAccounts`, and the connected path (`:685`) grants **any** origin that calls `eth_requestAccounts` while a wallet is connected. The pairing UI shows only a QR, never which origin is requesting. `grantPermission` is permanent; no code path revokes.
- **Why not fixed here**: a complete fix needs a **per-origin consent prompt + revoke UI** (a UX/product feature) and cannot be verified without the full extension E2E (relay + dApp). Scoping only the deferred grant would give false assurance while `:685` remains.
- **Owner condition**: UX decision on the consent flow (show requesting origin; explicit approve per origin; revoke list).
- **Acceptance**: connecting from site A does not grant site B; the approval UI names the origin; the user can list and revoke granted origins; `broadcastEvent` remains fail-closed.
- **Interim mitigation**: treat any connected wallet as visible to any origin that asks; advise users to disconnect when done.

### OI-5 · CF Worker relay has no global / per-IP limits (DoS / cost)
- **Evidence**: `index.ts` routes a Durable Object for any valid 64-hex channel id with zero throttling; no rate-limit config in `wrangler.jsonc`. The audit added a per-DO socket cap (8), which bounds per-channel abuse only.
- **Owner condition**: Cloudflare dashboard access to add WAF / Rate Limiting rules (per-IP request rate, connection rate) — or add a native CF Rate Limiting binding + deploy.
- **Acceptance**: an unauthenticated client scripting random channel ids is throttled at the edge; DO creation rate is bounded.

### OI-6 · Session key material stored unencrypted at rest
- **Evidence**: extension persists `session.serialize()` to `chrome.storage.local`; web to `localStorage`; snapshot embeds X25519 priv + ChaCha keys as hex, HMAC-tagged for integrity only (MAC key derives from `sendKey` in the plaintext; `restore()` accepts unsigned JSON). Comment corrected in the audit.
- **Impact**: local disk/backup/privileged-process read → decrypt/impersonate the channel for up to 24 h. **No fund-signing key exposed** (those stay on the mobile wallet).
- **Owner condition**: decide whether local-storage confidentiality is in scope (the audit brief currently treats it as out of scope).
- **Acceptance (if in scope)**: keys encrypted at rest (e.g. WebCrypto non-extractable / OS keystore); unsigned-JSON restore fallback removed.

### OI-7 · Observability gap on the production relay
- **Evidence**: CF worker exposes only `/healthz`; no `/readyz`, `/metrics`, or per-channel counters (the Rust relay has all three).
- **Acceptance**: prod relay exposes readiness + Prometheus/analytics metrics (active channels/connections, created/closed, rejects), with alerts wired.

## P3 — debt / polish

- **OI-8 · SDK 2.0.0 not published** — local `src` (BLE removed, relay param required) is labeled `1.1.0` while npm `1.1.0` still has BLE. Decide the version, publish, and bump consumer pins (`walletpair-extension`, `walletpair.org` at `^1.1.0`).
- **OI-9 · Website EVM-mode playground is partly canned** — `wallet_sendCalls` returns a hardcoded batch id; `wallet_getCallsStatus` returns empty receipts; `signTransaction`/`signTypedData`/`switchChain` fall through to `{status:'approved'}`. Only `wallet_signMessage` does real EIP-191. Label it a demo or implement.
- **OI-10 · Stale standalone examples** — `walletpair-examples/*.html` still implement the removed BLE transport from an esm.sh CDN. Update or remove.
- **OI-11 · Formal verification not run in CI + non-injective queries** — ProVerif isn't installed/run; the replay defense (monotonic receiver counter) and reconnect/counter-persistence/downgrade are unmodeled. README/brief overstate what's proven. Add a CI job (or clearly scope the claims).
- **OI-12 · Rust relay `cargo fmt` drift** — several `src/` files have hand-aligned comments that fail `cargo fmt --check`; normalize in a dedicated commit (kept out of the audit diff to stay reviewable). CI gates clippy + test, not fmt.
- **OI-13 · Rust per-IP limits behind a TLS proxy** — per-IP connection/create limits need `X-Forwarded-For` handling to be effective behind a reverse proxy.
- **OI-14 · Website has 0 unit test files** and its Playwright E2E hits the **live prod relay** (flaky, and load on prod). Add hermetic tests.
- **OI-15 · Extension `version 0.1.0`, `private: true`** — not marked production; Chrome Web Store submission is manual.

## Suggested sequencing
1. **OI-1** (redeploy + deploy CI) and **OI-5** (WAF) — makes prod match source and safe at scale.
2. **OI-3** (pick canonical relay) then **OI-7** (observability on it).
3. **OI-4** (consent UX) and **OI-2** (chain sync) — the two correctness/safety items needing product+testing.
4. Everything P3 as ongoing debt.
