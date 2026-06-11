# WalletPair Protocol v1 -- Security Audit Brief

Prepared: 2026-05-29
Protocol status: Release Candidate
Audit: First (no prior audits)

---

## 1. Audit Scope

### In-Scope Components

| Component | Language | LOC (approx) | Key Files |
|-----------|----------|-------------|-----------|
| **Protocol spec** | Markdown | 2,700 | `walletpair-protocol-v1.md`, `walletpair-evm-subprotocol-v1.md`, `walletpair-protocol-v1-rationale.md`, `walletpair-protocol-v1-guide.md` |
| **SDK** | TypeScript | ~20,000 (incl. tests) | `walletpair-sdk/src/crypto.ts`, `dapp-session.ts`, `wallet-session.ts`, `types.ts`, `ws-transport.ts`, `evm/eip1193.ts`, `evm/wagmi.ts` |
| **Relay** | Rust | ~4,700 (src) + ~2,350 (tests) | `walletpair-websocket-relay/src/{relay,session,protocol,state,store,ratelimit,config,http,persist,metrics,shutdown}.rs` |
| **Browser extension** | TypeScript + Svelte | ~7,500 | `walletpair-extension/src/entrypoints/background.ts`, `provider.content.ts`, `content.ts`, `src/lib/{messaging,storage,rpc-proxy,provider-factory,confirm-utils}.ts`, `src/entrypoints/confirm/App.svelte` |
| **Formal verification** | ProVerif | 279 | `formal-verification/walletpair.pv` |

### Lower Priority / Reference

| Component | Language | Notes |
|-----------|----------|-------|
| **Example webapp** | SvelteKit + TS | Demo dApp with wagmi integration. Review for insecure patterns only. |
| **Example wallet** | React Native (Expo) + TS | Demo mobile wallet. Review for insecure patterns only. |
| **Website** | SvelteKit | Marketing site (`walletpair.org/`). Out of scope. |
| **Load test tool** | Rust | `walletpair-websocket-relay/tools/loadtest/`. Out of scope. |

### Out of Scope

- Wallet or blockchain signing logic (handled by downstream wallet implementations)
- Relay deployment infrastructure (TLS termination, CDN, hosting)
- Third-party dependency audit (noble-curves, noble-hashes, noble-ciphers, tokio, etc.)
- Business payload schemas beyond the EVM sub-protocol

---

## 2. Architecture Overview

### System Diagram

```
                        PUBLIC NETWORK
                     (untrusted transport)

  +----------+          +----------+          +----------+
  |   dApp   |<-------->|  Relay   |<-------->|  Wallet  |
  | (browser)|   WSS    | (Rust)   |   WSS    |  (mobile |
  |          |          |          |          |   /ext)  |
  +----------+          +----------+          +----------+
       |                     |                     |
       |  E2E encrypted      |  Sees only:         |  E2E encrypted
       |  (ChaCha20-Poly1305)|  - channel ID       |  (ChaCha20-Poly1305)
       |                     |  - public keys       |
       |                     |  - message types     |
       |                     |  - dApp meta (name,  |
       |                     |    url, icon)        |
       |                     |  - message sizes     |
       |                     |  - timing            |
       +---------------------+---------------------+
```

### Trust Boundaries

**Relay CAN:**
- Deny service (drop, delay, or terminate any message/session)
- Observe traffic metadata (timing, sizes, frequency, public keys, message types)
- See dApp `meta` in `create` (name, URL, icon -- plaintext)
- Forge `terminate` messages (`from: "_adapter"`)

**Relay CANNOT:**
- Read encrypted payloads (method names, params, results, events, capabilities)
- Determine request success/failure (`_ok` is encrypted)
- Forge peer messages (lacks traffic keys)
- Replay messages (sequence counter prevents acceptance)
- Substitute wallet public key without detection (`sealed_join` decryption fails)

### Data Flow

```
1. PAIRING:    dApp creates channel -> embeds pubkey in QR/URI
2. KEY EXCHANGE: Wallet scans QR -> sends join(sealed_join) -> dApp accepts
                 Both derive: root_key -> transcript_hash -> traffic keys
3. SESSION:    Encrypted req/res/evt via ChaCha20-Poly1305
               Directional keys: dapp_to_wallet_key, wallet_to_dapp_key
4. CLOSE:      Either peer sends close, or relay sends terminate
               All key material zeroed on close
```

---

## 3. Cryptographic Primitives

### Primitive Inventory

| Primitive | Usage | Spec Section |
|-----------|-------|-------------|
| X25519 (ECDH) | Ephemeral key pair per channel, shared secret derivation | 6.1 |
| HKDF-SHA256 | root_key, join_encryption_key, dapp_to_wallet_key, wallet_to_dapp_key | 6.2 |
| SHA-256 | Transcript hash, session fingerprint, params hash (idempotency), canonical JSON vectors | 6.2, 6.5, 9.1 |
| HMAC-SHA256 | Nonce derivation from traffic_key + seq_bytes | 6.6 |
| ChaCha20-Poly1305 | AEAD encryption of req/res/evt and sealed_join | 6.6, 6.7 |
| RFC 8785 (JCS) | Canonical JSON for deterministic serialization in transcript hash | 6.3 |

### Key Derivation Chain

```
dApp private key + wallet public key
            |
            v
    shared_secret = X25519(...)         -- erased after root_key
            |
            v
    root_key = HKDF(shared_secret,      -- erased after traffic keys
                    salt=channel_id,
                    info="walletpair-v1 root")
            |
            +---> join_encryption_key = HKDF(root_key,
            |         salt=channel_id,          -- erased after sealed_join
            |         info="walletpair-v1 join-encryption")
            |
            +---> transcript_hash = SHA256(     -- erased after traffic keys
            |         "walletpair-v1-transcript" ||
            |         channel_id || lp(dapp_pub) || lp(wallet_pub) ||
            |         lp(canonical_json(capabilities)) ||
            |         lp(canonical_json(meta)) ||
            |         lp(dapp_name))
            |
            +---> dapp_to_wallet_key = HKDF(root_key,
            |         salt=transcript_hash,     -- persists for session
            |         info="walletpair-v1 dapp-to-wallet")
            |
            +---> wallet_to_dapp_key = HKDF(root_key,
                      salt=transcript_hash,     -- persists for session
                      info="walletpair-v1 wallet-to-dapp")
```

### Implementations Used

| Platform | Library | Notes |
|----------|---------|-------|
| **SDK (TypeScript)** | `@noble/curves` (X25519), `@noble/hashes` (HKDF, SHA-256, HMAC), `@noble/ciphers` (ChaCha20-Poly1305), `canonicalize` (JCS) | Pure JS, no native modules. Auditor should verify noble library versions. |
| **Relay (Rust)** | N/A -- relay does not perform crypto. It is a stateless message router. | Verify the relay truly never inspects or stores `sealed` content. |
| **Extension** | Imports SDK crypto module. | Key material lives in browser extension memory (service worker + content scripts). |

---

## 4. Threat Model

### Attacker Capabilities (from spec Section 19)

The protocol assumes the relay or transport may be fully compromised. The attacker can:
- Read all relay traffic (encrypted blobs + metadata)
- Modify, drop, reorder, or replay messages in transit
- Impersonate the adapter (send `terminate`)
- Create fake channels and attempt to squat legitimate ones

### What IS Protected

- Confidentiality of method names, params, results, events, capabilities
- Integrity and authenticity of encrypted messages (AEAD)
- Replay prevention (monotonic sequence counters)
- MITM prevention on QR-based pairing (out-of-band key delivery)

### What IS NOT Protected

- **Denial of service** -- relay can always sever connections
- **Traffic analysis** -- message sizes, timing, frequency are visible
- **Deep link MITM** -- if pairing URI is delivered via software channel, an intermediary can substitute it entirely (fingerprint mismatch is the only defense, requires user vigilance)
- **Fake wallet attack** -- relay can generate its own wallet keys and connect to the dApp (DoS / attacker-controlled wallet identity, not key compromise)
- **User phishing** -- protocol cannot prevent user from scanning a QR code on a fake dApp website
- **DApp meta leakage** -- dApp name/URL/icon in `create` is plaintext (asymmetry with encrypted wallet meta)

### Known Limitations

1. Session fingerprint is 4 decimal digits (10,000 values). Collision probability is ~0.01% per attempt, but this is a usability tradeoff.
2. Heartbeats are unencrypted -- relay can forge `ping`/`pong` (confuses liveness, does not compromise data).
3. Browser environments cannot guarantee key material erasure from JS heap or prevent swap to disk.
4. `terminate` messages cannot be authenticated -- the relay is trusted for availability, not integrity.

---

## 5. Areas of Concern

Ranked by protocol author's risk assessment (highest first):

### P0 -- Critical Path

1. **Key material exposure in browser environments.** The SDK uses `@noble/*` pure-JS crypto. Key bytes exist on the JS heap and cannot be locked or guaranteed erased. The extension runs in a service worker with even less memory control. Auditor should evaluate whether WebCrypto or WASM alternatives would reduce exposure.

2. **Sequence counter persistence.** Counter reuse with the same traffic key breaks ChaCha20-Poly1305 (plaintext recovery via crib-dragging). The spec mandates MUST NOT reconnect if counters are lost. Auditor should verify the SDK and extension enforce this, and evaluate crash/kill scenarios on each platform.

3. **Deep link URI substitution.** On same-device pairing, a malicious app can intercept the deep link and replace the entire URI. The only defense is the 4-digit fingerprint. Auditor should evaluate the fingerprint's effectiveness against targeted attacks and whether the extension/SDK properly restrict deep-link sessions to read-only.

### P1 -- High

4. **Relay metadata leakage (timing/size analysis).** The relay sees message types, sizes, and timing. An adversary could infer transaction patterns, chain activity, or user behavior from traffic shape. Auditor should assess whether padding or batching is needed.

5. **Session fingerprint collision space.** 4 digits = 10,000 values. In a targeted attack where the attacker controls the relay, they can precompute key pairs to find a collision. Auditor should estimate the cost of a birthday-style search on the fingerprint space.

6. **Idempotency cache as side channel.** Replaying a request ID with different params produces `invalid_params` (distinguishable from normal processing). The spec requires constant-time params hash comparison. Verify this is implemented.

### P2 -- Medium

7. **`_adapter` impersonation.** Any message with `from: "_adapter"` is treated as relay-originated. Peers must reject peer-sent messages claiming `from: "_adapter"`. Verify enforcement in SDK and extension.

8. **Reconnect race conditions.** Two documented races (wallet arrives before dApp creates; stale connected state blocks create). Verify backoff and retry logic handles both correctly without leaking state or creating duplicate sessions.

---

## 6. Attack Scenarios to Test

### 6.1 Malicious Relay

| Scenario | Expected Outcome |
|----------|-----------------|
| **Key substitution:** Relay replaces wallet public key in forwarded `join`. | `sealed_join` decryption fails. DApp closes with `decryption_failed`. |
| **Message replay:** Relay re-sends a previously forwarded `req` or `res`. | Receiver rejects: sequence number not strictly greater than last accepted. |
| **Session hijack on reconnect:** Relay creates fake wallet key pair and sends `join` before legitimate wallet. | DApp accepts fake wallet, but fake wallet cannot decrypt/forge sealed messages with real traffic keys. First sealed message from impostor fails AEAD. |
| **Selective message drop:** Relay drops specific `req` or `res` messages. | DoS only. Pending request timeout triggers retry or reconnect. |
| **Reflection attack:** Relay bounces dApp's encrypted `req` back as a `res`. | Fails: directional keys are different. `wallet_to_dapp_key` != `dapp_to_wallet_key`. |
| **Forge `terminate`:** Relay sends `terminate` with `from: "_adapter"`. | Session ends (DoS). Peers should reconnect automatically. |
| **Forge heartbeat:** Relay sends fake `pong` to prevent timeout detection. | Liveness confusion. Does not compromise data. Verify implementation handles this gracefully. |

### 6.2 Malicious DApp

| Scenario | Expected Outcome |
|----------|-----------------|
| **Exceed pending request limit:** Send >32 concurrent `req` messages. | Wallet replies with error `res` (code `rate_limited`) for excess requests. Channel stays open. |
| **Send after close:** Send `req` after `close` message. | Wallet ignores or adapter rejects (channel in closed state). |
| **Call unauthorized method:** Send `req` for a method not in `capabilities.methods`. | Wallet replies with error `res` (code `unsupported_method`). Channel stays open. |
| **Request on unauthorized chain:** Send `req` targeting a chain not in `capabilities.chains`. | Wallet replies with error `res` (code `unsupported_chain`). Channel stays open. |
| **Tampered request ID reuse:** Retry a `req.id` with different params. | Wallet returns `invalid_params` from idempotency cache. |

### 6.3 Malicious Wallet

| Scenario | Expected Outcome |
|----------|-----------------|
| **Send events for unauthorized event types:** Emit `evt` with `_event` not in `capabilities.events`. | DApp should ignore unknown events (spec: log and ignore). |
| **Sequence number manipulation:** Send a sealed message with a sequence number equal to or less than last accepted. | DApp rejects the message. |
| **Send `req` instead of `res`:** Wallet sends a `req` message. | Protocol violation -- only dApp sends `req`. Adapter should reject; dApp should ignore. |
| **Double-join:** Send a second `join` after already connected. | Adapter rejects with `already_connected`. |

### 6.4 Network Attacker

| Scenario | Expected Outcome |
|----------|-----------------|
| **Deep link URI substitution:** Replace pairing URI with attacker-controlled key. | Session fingerprint mismatch. User must notice the mismatch to abort. |
| **WebSocket downgrade:** Attempt to connect via `ws://` instead of `wss://`. | Relay should only accept `wss://`. Verify relay TLS enforcement. |

---

## 7. Test Vectors

### Existing Vectors (Appendix A of spec)

The spec includes complete test vectors for:
- A.1: Key material (dApp/wallet key pairs, channel ID, shared secret)
- A.2: Key derivation (root_key, join_encryption_key)
- A.3: Sealed join (canonical JSON, nonce, AAD, ciphertext+tag, base64url output)
- A.4: Transcript hash and traffic keys
- A.5: Session fingerprint computation
- A.6: AEAD encryption (dApp-to-wallet, seq=0, complete nonce + AAD + ciphertext)

Additionally, Section 6.3 provides canonical JSON test vectors with SHA-256 hashes (vectors 1-6).

### Additional Vectors Recommended

| Vector | Purpose |
|--------|---------|
| AEAD encryption at seq=1, seq=2 | Verify sequence counter increment and nonce uniqueness |
| Wallet-to-dApp direction (using `wallet_to_dapp_key`) | Verify directional key separation |
| Sequence counter at boundary (`2^31 - 1` and `2^31`) | Verify overflow handling and forced close |
| All-zero shared secret (low-order point) | Verify rejection per Section 6.2 validation |
| `sealed_join` with tampered AAD | Verify AEAD authentication failure |
| Reconnect scenario: same keys, continued sequence numbers | Verify counter persistence across reconnects |
| AAD with maximum-length fields (near 65535 byte limit) | Verify `lp()` length prefix boundary handling |
| Malformed `sealed` (truncated, wrong base64url) | Verify graceful error handling |

---

## 8. Previous Audit History

**This is the first security audit.** No prior audits have been conducted.

### Spec Revision History

All revisions are on the `main` branch. Key commits in reverse chronological order:

| Commit | Description |
|--------|-------------|
| `8380c77` | Add RPC method routing (wallet ops vs read-only) |
| `61c23e5` | Align Appendix B sub-protocol guide with EVM structure |
| `9dacaf9` | Enforce required tx fields, session expiry, capability validation |
| `6b35832` | Fix spec compliance across SDK, relay, extension, examples |
| `7b0f16f` | Add reconnect race condition handling rules |
| `0d00908` | Final polish: grammar, typography, naming precision |
| `e454e13` | Fix protocol spec: error codes, reject semantics, edge cases |
| `eac855c` | Reduce redundancy while preserving security emphasis |
| `52d6adf` | Replace hand-rolled canonicalJson with `canonicalize` library (RFC 8785) |
| `91dfdd2` | Require all wallet meta fields, recompute test vectors |
| `8479d26` | Align SDK implementation with protocol spec |
| `71b36d0` | Add ProVerif formal verification model |
| `0e7f230` | Enforce RFC 8785 canonical JSON, harden crypto tests |

### Formal Verification

A ProVerif model (`formal-verification/walletpair.pv`, 279 lines) exists. It models the key exchange and encrypted messaging. The auditor should review whether the model accurately captures the protocol and what properties it verifies.
