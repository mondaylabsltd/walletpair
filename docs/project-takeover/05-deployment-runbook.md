# 05 — Deployment Runbook

There are **four independently deployed artifacts**: the SDK (npm), the CF worker relay (prod), the website (Cloudflare), and the extension (GitHub release / store). The Rust relay is buildable but **not currently deployed**.

> ⚠️ All deploys below are **irreversible or externally visible** (publishing, pushing to prod). Get explicit sign-off; nothing here should run unattended. Cloudflare custom-domain routing for `walletpair.org` and `relay.walletpair.org` appears to live **only in the Cloudflare dashboard** — reproducing a deploy from the repo yields a `*.workers.dev` URL unless that routing exists. Confirm the dashboard state before relying on a repo-only deploy.

## A. CF Worker relay → `relay.walletpair.org` (**highest priority**)

Production currently runs **stale code** (pre-`1f07e77`; observed pending-request limit 32 vs current 256, and the old terminate-on-blip behavior). Redeploy from current source.

**Pre-deploy checklist**
- [ ] `cd walletpair-websocket-relay-cf-worker && npm ci`
- [ ] `npm run typecheck` → clean
- [ ] `npm test` → green (runs in CI / on a normal machine)
- [ ] `npx wrangler deploy --dry-run --outdir dist` → bundles ok
- [ ] Confirm you are authenticated to the correct Cloudflare account (`wrangler whoami`) and that the `walletpair-relay` worker + `relay.walletpair.org` route exist in the dashboard.
- [ ] Confirm **CF WAF / Rate Limiting rules** exist for the zone (the worker has no global/per-IP limits — see [04](04-production-readiness.md) #4). If absent, add them before or with this deploy.

**Deploy**
```bash
cd walletpair-websocket-relay-cf-worker
npx wrangler deploy
```
Durable Object migration `v1` (`new_classes: ["ChannelDO"]`) already applied; no new migration in this change.

**Smoke (post-deploy)**
```bash
curl -s https://relay.walletpair.org/healthz            # ok
# Full protocol smoke — run the SDK-side live suite:
cd ../walletpair-websocket-relay-cf-worker && npx vitest run --config vitest.live.config.ts   # 41/41 against prod
```
Verify the pending-request limit is now 256 (a `req`-flood no longer terminates at 32) to confirm the new code is live.

**Rollback**: `wrangler rollback` (or `wrangler deploy` a previous git checkout). DO state is per-channel and ephemeral (5-min unpaired / 24-h connected TTL); a rollback drops in-flight channels — peers re-pair.

## B. walletpair-sdk → npm

Uses **changesets** + the `zile` build tool.
```bash
cd walletpair-sdk
pnpm install && pnpm exec tsc && pnpm exec vitest run    # gates
pnpm changeset            # (if not already) record the version bump
pnpm changeset:version    # apply versions + changelog
pnpm changeset:publish    # zile publish:prepare && changeset publish && zile publish:post
```
- **Version note:** local `src` is the 2.0-to-be artifact (BLE removed, relay param required) but is still labeled **1.1.0**. Decide the target version before publishing to avoid a split-brain with the already-published 1.1.0 (which still contains BLE). Consumers (`walletpair-extension`, `walletpair.org`) pin `^1.1.0`; bump them when 2.0.0 lands.
- Rollback: npm publishes are immutable; use `npm deprecate` and publish a patch. Do **not** unpublish.

## C. walletpair.org → Cloudflare Workers

```bash
cd walletpair.org
pnpm install
pnpm build          # if it fails on stale worker-configuration.d.ts: npx wrangler types, then rebuild
pnpm deploy         # pnpm build && wrangler deploy
```
Smoke: load the homepage and the `/playground` (Protocol mode runs a real dual SDK session).

## D. Extension → GitHub release (and, later, web store)

Already automated: `.github/workflows/release-extension.yml` builds + zips `.output/chrome-mv3` on push to `main` (dev release) or an `extension-v*` tag (versioned release).
```bash
git tag extension-v0.1.0 && git push origin extension-v0.1.0   # triggers a versioned release
```
Store submission (Chrome Web Store) is **manual and not automated**. Note the extension is not yet marked production (`version 0.1.0`, `private: true`).

## Order of operations for a coordinated release
1. Publish SDK (decide version) → 2. Deploy CF worker relay → 3. Deploy website → 4. Cut extension release. Each has an independent rollback; there is no cross-artifact migration.

## New: CI gate
`.github/workflows/ci.yml` runs test/typecheck/lint/build for all packages on push/PR. **Recommended before enabling prod deploys:** add a deploy job (mirroring `release-extension.yml`) that runs `wrangler deploy` for the CF worker and website on merge to `main`, so the deployed relay can never again drift from source.
