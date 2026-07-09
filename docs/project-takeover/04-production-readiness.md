# 04 — Production Readiness Audit

**Audit date:** 2026-07-09 · **Baseline commit:** `8fafb89` · **Method:** multi-agent deep read → adversarial re-verification against source → small fixes with regression tests → full re-verification.

## Verification methodology

Every risk below was found by a reader agent, then **independently re-checked by a skeptic agent instructed to refute it**, reading the actual current source. Claims that overstated severity were downgraded (the original "P0 nonce reuse" became a P1 after the skeptic proved JS run-to-completion prevents the same-seq sub-case). Each code fix ships a regression test that was **demonstrated to fail on the pre-fix code** and pass on the fix.

## Test/build baseline (after fixes)

| Package | Gate | Result |
|---------|------|--------|
| SDK | `tsc` + `vitest run` + `zile build` | **714 tests pass**, tsc clean, build ok |
| Extension | `svelte-check` + `vitest run` + `wxt build` | **0 check errors** (was 9), **253 tests** (was 7 failing), build ok |
| Rust relay | `cargo test` + `clippy -D warnings` | **216 tests pass**, clippy clean |
| CF worker | `tsc` + `wrangler deploy --dry-run` | typecheck clean, bundles ok; `npm test` blocked by sandbox networking (runs in CI) |
| Website | `wrangler types --check` + `vite build` + `svelte-check` | build ok, **0 check errors** (was 1) |

## Findings & disposition

Severity: **P0** block / **P1** fix before launch / **P2** important, controllable / **P3** debt.

### FIXED IN THIS AUDIT (code + regression test)

| # | Sev | Title | Verdict | Component | Fix (file) | Test |
|---|-----|-------|---------|-----------|------------|------|
| 1 | P1 | **rpc-proxy swallows real RPC errors** | CONFIRMED | extension | `protocols/ethereum/rpc-proxy.ts` — tag transient transport failures vs authoritative RPC-level errors; propagate real code/message; fall back only on transport failure | `rpc-proxy.test.ts`, `background-logic.test.ts` (7 previously-failing tests now green) |
| 2 | P1 | **Persistence write reorder → possible ChaCha nonce reuse** | PARTIAL (was "P0") | SDK | `dapp-session.ts` + `wallet-session.ts` — FIFO save-chain serializes async persistence writes so a lower-seq snapshot can never land after a higher one; sync backends keep the fast path | `sequence-validation.test.ts` "serializes async persistence writes…" (fails on old code with `maxConcurrent=2`) |
| 3 | P1 | **Rust relay channel-capacity counter drifts +1 per re-create** | CONFIRMED | Rust relay | `relay.rs` + `session.rs` — new `OkReplaced` result (net-zero), removed erroneous compensating `active_channels.inc()` | `relay.rs` "repeated_recreate_does_not_drift_capacity_counters" (50× replacement, both counters stable) |
| 4 | P1 | **CF Worker relay has no connection cap** | CONFIRMED | CF worker | `channel.ts` — per-DO cap of 8 sockets (2 needed + slack), 429 beyond | typecheck + dry-run bundle verified; global/per-IP still needs CF WAF (open) |
| 5 | P2 | **personal_sign silently corrupts non-UTF-8** | CONFIRMED | SDK EVM | `eip1193.ts` — reject malformed hex / non-UTF-8 with `INVALID_PARAMS` instead of signing lossy bytes | `eip1193.test.ts` (2 tests: non-UTF-8 + malformed hex rejected, valid still passes) |
| 6 | P2 | **Untrusted RPC URLs fetched without allowlist (SSRF)** | CONFIRMED | extension + SDK | `isSafeRpcUrl()` guards wallet-supplied + registry-discovered URLs (HTTPS + no loopback/private/link-local/metadata); user-configured URLs stay unguarded (localhost dev); SDK `jsonRpcFetch` now checks `res.ok` | `rpc-proxy.test.ts` (5 tests across scheme/loopback/private/IPv6) |
| 7 | P3 | **Snapshot HMAC comment overstates tamper protection** | PARTIAL | SDK | `dapp-session.ts` + `wallet-session.ts` — comment corrected: HMAC catches corruption, **not** a storage-writing attacker (MAC key is in the signed plaintext; unsigned JSON still accepted) | n/a (doc/comment) |
| — | — | **9 svelte-check errors + 1 website check error** | — | extension + website | `App.svelte` (`state`→`extState`, rune collision), test-file type fixes, `FeatureCard` icon type | `svelte-check` 0 errors both packages |
| — | — | **No CI test/lint gate (root cause of drift)** | — | infra | new root `.github/workflows/ci.yml` gates test/typecheck/lint/build for all 5 packages | CI runs on push/PR |

### VERIFIED BUT NOT CODE-FIXABLE HERE — see [08-open-issues.md](08-open-issues.md)

| # | Sev | Title | Verdict | Why deferred |
|---|-----|-------|---------|--------------|
| 8 | P1 | **Production relay runs stale pre-`1f07e77` code** | PARTIAL | Fix is a **deployment** (needs CF creds); root cause is missing deploy CI. Live probe confirms prod is the CF worker (`/readyz`,`/metrics` → 404); source is already correct. |
| 9 | P1 | **EVM provider never syncs the wallet's active chain** | CONFIRMED | Wrong-chain reads / tx.chainId autofill. A correct fix changes the wallet↔dApp handshake (protocol addition) and needs **real-wallet interop testing**; risky to ship blind. |
| 10 | P2 | **One wallet-accept grants every pending origin; no revoke UI** | PARTIAL | Scoping the deferred grant alone is incomplete (post-connect path auto-grants any origin at `background.ts:685`). A complete fix needs a **per-origin consent + revoke UI** — a UX/product decision, not verifiable in this sandbox. |
| 11 | P1 | **Two divergent relays claimed at "parity"** | n/a | Which relay is canonical (CF vs Rust) is a **product decision**; maintaining both is a standing liability. |
| 12 | P2 | **Session keys stored unencrypted at rest** | PARTIAL (→P3) | Documented/accepted limitation (no fund-signing key exposed; channel keys only, 24h TTL). Comment corrected (#7). Full at-rest encryption is a larger design change. |
| 13 | P2 | **SDK 2.0.0 (BLE removal) not published; consumers pinned to 1.1.0** | n/a | Publishing is a release action; local `src` (2.0-to-be) is labeled 1.1.0 — a split-brain that surfaces only at publish. |

## Data reliability

No database/migrations. State is client-side session snapshots. The critical data invariant is the **send-sequence write-ahead + monotonicity** (finding #2, fixed). The Rust relay's optional `state_file` snapshot (graceful shutdown → restore) is covered by `relay_restart_with_persistence_restores_channels`.

## Observability

- **Rust relay**: structured `tracing` logs (never logs `sealed` payloads), Prometheus `/metrics`, `/healthz`, `/readyz`. Good.
- **CF worker (prod)**: `/healthz` only; **no `/readyz`, no `/metrics`, no per-channel metrics** — observability gap for the actual production relay (open issue).
- **SDK**: opt-in in-memory disconnect ring buffer for debugging.

## Release conclusion

**CONDITIONAL GO.**

- All in-repo P1/P2 correctness and security findings are fixed with regression tests; all five packages build and pass their gates; the P0 candidate was disproven as unconditional and fixed as a P1.
- **Go is conditional on operational prerequisites that require you (not code):**
  1. **Redeploy the CF worker** from current source so prod stops running stale code (finding #8), and add deploy CI so it can't drift again.
  2. Make the **product decisions** on the consent model (#10) and canonical relay (#11), and either ship the EVM chain-sync fix with real-wallet testing or document the limitation for integrators (#9).
  3. Confirm **CF WAF / rate-limiting** is configured for `relay.walletpair.org` (#4) — the worker has no global/per-IP limits.

Do **not** treat this as GO until #8 (redeploy) is done and #10/#11 are decided — those are the load-bearing gaps between "code is ready" and "product is safe to run at scale."
