# 01 — System Overview

## What WalletPair is

WalletPair is a **self-sovereign, zero-registration pairing protocol** connecting dApps with blockchain wallets, positioned as a WalletConnect alternative. A dApp creates a channel and shows a pairing URI (QR); the wallet scans it; after an X25519 handshake with a visual fingerprint check, the two peers hold an **end-to-end encrypted session** and exchange signing requests. The relay in the middle is *blind* — it routes opaque ciphertext and never sees keys or plaintext.

Design pillars (from `readme.md`): no API keys/project IDs, peers exchange keys directly, all payloads E2E-encrypted, a single WebSocket transport, chain-agnostic via CAIP-2 (EVM fully implemented; Solana/Cosmos extensible).

## Cryptography (the core value proposition)

Implemented in `walletpair-sdk/src/crypto.ts`, spec in `walletpair-protocol-v1.md`:

- **Key exchange**: X25519 ephemeral keypairs, rejecting the all-zero/low-order shared secret (RFC 7748 §6).
- **Key derivation**: HKDF-SHA256 with `channel_id` salt and domain-separated info strings; a handshake transcript hash binds channelId, both pubkeys, capabilities, wallet meta, and dApp name into the directional keys.
- **AEAD**: ChaCha20-Poly1305. Nonce = `HMAC-SHA256(dirKey, uint32_be(seq))[0:12]`; AAD includes a type byte (0x01 req / 0x02 res / 0x03 evt / 0x04 sealed_join) to prevent cross-type confusion.
- **Canonical JSON**: RFC 8785 (JCS), with SHA-256 test vectors that reproduce byte-for-byte.
- **Fingerprint**: `SHA256(prefix ‖ channel_id ‖ dapp_pubkey) mod 10000` for visual MITM detection.
- **Replay protection**: per-direction strictly-monotonic receive counters; write-ahead persisted send counters.
- **Formal verification**: ProVerif model (`formal-verification/`) proving confidentiality + authentication of req/res/evt and the `sealed_join` handshake under a Dolev-Yao attacker who controls the relay.

## Repository layout

```
walletpair/
  walletpair-sdk/                    TypeScript SDK — protocol, crypto, sessions, EVM adapter  [PUBLISHED npm 1.1.0]
  walletpair-extension/              Chrome MV3 extension (WXT + Svelte 5) — dApp-side bridge
  walletpair-websocket-relay/        Rust (Axum/Tokio) reference relay                          [NOT the prod relay]
  walletpair-websocket-relay-cf-worker/  Cloudflare Worker + Durable Objects relay             [SERVES relay.walletpair.org]
  walletpair.org/                    SvelteKit marketing/docs/playground on Cloudflare Workers
  walletpair-examples/               Standalone HTML, React Native, SvelteKit demos             [some stale]
  formal-verification/               ProVerif models
  *.md                               Protocol spec (transport + crypto + EVM binding), guide, rationale, audit brief
```

## Component maturity (post-audit)

| Component | Grade | One-line reason |
|-----------|-------|-----------------|
| SDK core (crypto/session) | **Production** | 714 tests, strict tsc, spec crypto vectors reproduce byte-for-byte; persistence write-ordering now serialized (was the P0 candidate). |
| SDK EVM (EIP-1193 + wagmi) | **Beta** | Solid method mapping; personal_sign non-UTF-8 now rejected; **active-chain sync still missing** (open issue). |
| Extension (MV3 bridge) | **Beta** | Bridge works; unit tests + svelte-check now green; **multi-origin consent model needs redesign** (open issue). |
| Rust relay | **Beta** | High-quality; capacity-counter drift fixed; per-IP limits need `X-Forwarded-For` behind a proxy; **not the prod deployment**. |
| CF Worker relay (**prod**) | **Beta** | Serves prod; per-DO connection cap added; **no global/per-IP limits** (needs CF WAF) and **prod runs stale code**. |
| Website | **Beta** | Builds and the protocol-mode playground runs a real dual SDK session; EVM-mode playground wallet is partly canned/demo. |
| Specs | **Production** | Internally consistent; all crypto vectors reproduce. |
| Formal verification | **Prototype** | Real queries but non-injective (replay defense unmodeled); ProVerif not run in CI. |
| Infra / CI | **Prototype → improving** | Was build-only; a root `ci.yml` now gates test/typecheck/lint/build for all packages. |

## Tech stack

| Layer | Tech |
|-------|------|
| SDK | TypeScript, `@noble/curves` `@noble/hashes` `@noble/ciphers`, `canonicalize`; build via `zile`; test via Vitest; lint via Biome |
| Extension | Svelte 5, WXT, TypeScript, Vitest + Puppeteer E2E |
| Rust relay | Rust, Axum 0.8, Tokio, Prometheus; cargo-fuzz targets |
| CF relay | Cloudflare Worker + Durable Objects, Wrangler, vitest-pool-workers |
| Website | SvelteKit 2 (Svelte 5 runes), `@sveltejs/adapter-cloudflare`, Vitest + Playwright |

## Key runtime dependencies & third-party services

- **Relay** `wss://relay.walletpair.org/v1` — the CF Worker. The relay is stateless and holds no secrets.
- **RPC discovery** — read-only EVM calls proxy to public nodes (`DEFAULT_RPC` map) and, on failure, a fallback list from `ethereum-data.awesometools.dev`. Untrusted URLs are now SSRF-guarded (`isSafeRpcUrl`).
- No database, queue, or auth provider. All session state is client-side (SDK `SessionPersistence`); the relay keeps only in-memory channel routing (+ optional file snapshot on the Rust relay).

## High-level data flow

```
dApp (wagmi/EIP-1193) ──> walletpair-sdk DAppSession ──┐
                                                        ├─ WebSocket ─> Relay (blind) ─> Wallet (WalletSession / extension)
Wallet signs, returns sealed res/evt  <─────────────────┘
```

Concrete call chains are in [03-core-flows.md](03-core-flows.md).
