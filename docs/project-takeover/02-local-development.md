# 02 — Local Development

## Prerequisites

| Tool | Version used in audit | Notes |
|------|----------------------|-------|
| Node | 22 (`.nvm` v22.22.3) | CI pins node 22 |
| pnpm | 10 (10.9.0) | SDK/extension/website use pnpm; SDK pins `pnpm@10.12.1` |
| npm | bundled | CF worker uses npm (`package-lock.json`) |
| Rust | stable (1.95) | relay; `cargo`, `clippy` |
| wrangler | 4.x | CF worker + website deploy/types |
| ProVerif | (optional) | `opam install proverif` to run `formal-verification/*.pv` — **not installed in CI** |

There is **no repo-root workspace**; each package installs independently.

## Per-package: install, check, test, build

### walletpair-sdk
```bash
cd walletpair-sdk
pnpm install
pnpm exec tsc          # typecheck (strict; noUncheckedIndexedAccess, exactOptionalPropertyTypes)
pnpm exec vitest run   # 714 tests
pnpm build             # `zile` — builds dist/ ESM + d.ts
```

### walletpair-extension
```bash
cd walletpair-extension
pnpm install           # postinstall runs `wxt prepare`
pnpm check             # svelte-check (0 errors expected)
pnpm exec vitest run   # 253 unit tests
pnpm build             # → .output/chrome-mv3/  (load unpacked in chrome://extensions)
pnpm test:e2e          # Puppeteer E2E — needs the demo dApp served at http://localhost:3000/dapp.html
```
> The extension depends on `walletpair-sdk@^1.1.0` **from the npm registry**, not a local link. To test against local SDK changes, `pnpm link` the SDK or bump/publish it.

### walletpair-websocket-relay (Rust)
```bash
cd walletpair-websocket-relay
cargo test                                   # 158 lib + 51 integration + 7 reliability
cargo clippy --all-targets -- -D warnings
cargo build --release
WALLETPAIR_CONFIG=/dev/null ./target/release/walletpair-relay   # runs on 0.0.0.0:8080 with defaults
curl -s localhost:8080/healthz               # ok
curl -s localhost:8080/readyz                # ready
curl -s localhost:8080/metrics | head        # prometheus
```
> `cargo fmt --check` currently reports pre-existing drift across several `src/` files (hand-aligned comments); it is **not** wired into CI. Normalize with `cargo fmt` in a dedicated cleanup commit if desired.

### walletpair-websocket-relay-cf-worker
```bash
cd walletpair-websocket-relay-cf-worker
npm install
npm run typecheck                            # clean
npx wrangler deploy --dry-run --outdir dist  # validates the worker bundles
npm test                                     # vitest-pool-workers — see caveat below
npm run dev                                  # local workerd dev server
```
> **Caveat:** `npm test` (and `test:live`) failed to start in the audit sandbox with `EADDRNOTAVAIL 127.0.0.1` / `No such module node:perf_hooks` — a local networking limitation of the sandbox, not a code fault. These run in normal CI / on a normal dev machine. `test:live` exercises the **live** relay at `wss://relay.walletpair.org` and passed 41/41 when run from the SDK-side live suite.

### walletpair.org
```bash
cd walletpair.org
pnpm install
pnpm build             # `wrangler types --check && vite build`
pnpm check             # wrangler types --check && svelte-kit sync && svelte-check (0 errors)
pnpm dev               # local dev server
pnpm test:e2e          # Playwright — hits the LIVE prod relay
```
> If `pnpm build` fails with *"Types at worker-configuration.d.ts are out of date"*, run `npx wrangler types` to regenerate (the committed file drifts when the installed wrangler version changes).

## Environment variables & config

There are **no secret env vars required to run locally.** Notable knobs:

| Where | Variable / file | Effect |
|-------|------------------|--------|
| Rust relay | `WALLETPAIR_CONFIG` | path to a TOML config (`config.example.toml` documents every key; all optional, all have defaults) |
| Rust relay | `RUST_LOG` | log level override |
| SDK (debug) | `WALLETPAIR_DEBUG`, `globalThis.__WALLETPAIR_DEBUG__`, `localStorage['walletpair:debug']` | enable the in-memory disconnect ring buffer |
| CF worker | `wrangler.jsonc` | Durable Object binding `CHANNEL`; **no account_id or secrets committed** |
| Website | `wrangler.jsonc` | adapter-cloudflare worker config |

**Secret hygiene:** no `.env`, `config.toml` with prod values, or `account_id` is committed. `walletpair-websocket-relay/.gitignore` excludes `config.toml`; the committed `config.toml` is defaults-only.

## Live relay smoke (no build needed)
```bash
curl -s https://relay.walletpair.org/healthz   # ok  (200)
curl -s -o /dev/null -w '%{http_code}' https://relay.walletpair.org/readyz   # 404 — confirms the CF worker (Rust relay would answer 200)
```
