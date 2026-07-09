# 06 — Operations Runbook

## What to watch

### CF Worker relay (production)
- **Health**: `GET https://relay.walletpair.org/healthz` → `ok`. This is the **only** operational endpoint the CF worker exposes today.
- **No `/readyz`, no `/metrics`, no per-channel metrics.** Observability for the production relay is a gap ([08](08-open-issues.md)). Until closed, rely on the **Cloudflare dashboard**: Workers analytics (requests, errors, CPU/duration), Durable Object metrics (active DOs, storage), and WebSocket connection counts.
- **Logs**: `wrangler tail` streams live logs. The worker never logs `sealed` payloads by design.

### Rust relay (if/when deployed)
- `GET /healthz` (liveness), `GET /readyz` (503 at capacity), `GET /metrics` (Prometheus). Key series:
  - `walletpair_active_channels`, `walletpair_active_connections` (gauges)
  - `walletpair_channels_created_total`, `_connected_total`, `_joined_total`, `_closed_total{reason}` (counters)
  - `walletpair_messages_rejected_total{reason}`, `walletpair_outbound_queue_drops_total` (slow consumers)
- Set up alerts on: `/readyz` flapping to 503, `messages_rejected_total{reason="max_channels"}` rising, `outbound_queue_drops_total` climbing.

## Common failures & triage

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| dApp connect hangs on QR forever | wallet never scanned; unpaired channel TTL (5 min CF / 300 s Rust) will GC it | expected; user re-pairs. Check `/healthz`. |
| Session terminates after ~32 in-flight requests | **prod relay is still stale** (old pending limit 32) | redeploy CF worker ([05](05-deployment-runbook.md#a-cf-worker-relay)) — the fix (256) is in source but not live |
| Mobile wallet backgrounds → session drops unrecoverably | stale prod relay terminates the healthy peer on transient absence | same: redeploy CF worker (the `1f07e77` recoverable-reason fix is not live) |
| Reads return wrong-chain data / tx has wrong chainId | EVM provider assumes chain from config, never syncs wallet's active chain ([08](08-open-issues.md) #9) | user switches chain in the dApp; long-term needs the chain-sync fix |
| `eth_call` returns a generic "No RPC found" instead of the revert reason | (pre-fix) rpc-proxy error masking — **fixed** in this audit | ensure the extension build post-dates the fix |
| `/readyz` stuck at 503 on the Rust relay despite low load | capacity-counter drift — **fixed** in this audit | ensure the relay binary post-dates the fix |
| Relay cost spike / many Durable Objects | no global/per-IP cap on the CF worker; possible channel-id flooding | confirm CF WAF/rate-limit rules; the per-DO cap (8 sockets) limits per-channel abuse only |
| Extension: a site sees accounts it shouldn't | multi-origin consent gap ([08](08-open-issues.md) #10) | until the consent redesign, treat any connected wallet as visible to any origin that calls `eth_requestAccounts` while connected |

## Incident: suspected key/session compromise

Session keys live in client storage (extension `chrome.storage.local`, web `localStorage`) **unencrypted**; no fund-signing key is ever exposed (those stay on the mobile wallet). If a client device is compromised: the user should **disconnect** (clears the session) and re-pair; the exposed channel keys are useless after the 24 h session TTL and after re-pairing (new ephemeral keys).

## Capacity & scaling

- **CF worker**: scales horizontally (one Durable Object per channel). Watch DO count and cost; there is no protocol-level global cap, so cost is bounded only by CF WAF.
- **Rust relay**: single process; `max_connections` (10k), `max_channels` (50k), `outbound_queue_size` (64) in config. Behind a TLS proxy the per-IP limits are ineffective without `X-Forwarded-For` handling ([08](08-open-issues.md)).

## Graceful shutdown / disaster recovery

- Rust relay: on SIGTERM it sends `close` to peers and (if `state_file` set) snapshots channel state, restoring on restart. Peers reconnect with resume tokens.
- CF worker: DOs hibernate/wake transparently; there is no cross-DO state to back up. Recovery = redeploy; in-flight channels re-pair.
