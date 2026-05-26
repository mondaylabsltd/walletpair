# WalletPair Protocol v1

Status: Draft

WalletPair is a minimal, permissionless two-party channel protocol for
connecting dApps and wallets. All payloads are end-to-end encrypted. The
relay is a stateless message router that cannot read, forge, or replay
application data.

The protocol is transport-independent. The same messages run over
WebSocket relay, Bluetooth, or any ordered bidirectional transport.

See `walletpair-protocol-v1-rationale.md` for design decisions and
security analysis. See `walletpair-protocol-v1-guide.md` for
implementation guidance, platform advice, and complete examples.

## 1. Scope

WalletPair defines:

- channel creation and pairing URI
- key exchange and end-to-end encryption
- capability negotiation
- session fingerprint and user confirmation
- request, response, and event messages
- heartbeat, close, and reconnect

WalletPair does not define:

- wallet or signing logic
- business payload schemas (defined by sub-protocols)
- relay cluster architecture or storage backend

## 2. Roles

Each channel has exactly two peer roles and one adapter.

### DApp

Creates the channel, accepts the wallet, sends requests. May send:

```text
create, accept, req, ping, pong, close
```

### Wallet

Joins an existing channel, handles requests, pushes events. May send:

```text
join, res, evt, ping, pong, close
```

### Transport Adapter

The adapter (relay, BLE stack, etc.) manages channel state. It is not a
peer. It may send:

```text
ready, terminate
```

Adapter messages use `from` = `"_adapter"` (reserved identifier, not a
key). Peers MUST reject any peer-sent message where `from` equals
`"_adapter"`.

The wallet does not create channels. The dApp does not send events.

## 3. Identifiers

### Channel ID (`ch`)

Random 32-byte value, hex-encoded (64 characters). MUST have 256 bits
of cryptographic randomness.

### Sender Identity (`from`)

Present in every message:

- **Peer messages:** sender's X25519 public key, base64url no padding.
- **Adapter messages:** the string `"_adapter"`.

### Request ID (`id`)

Unique per `req`. The wallet copies the same `id` into the matching
`res`. SHOULD be UUID v4 or equivalent entropy.

## 4. Message Format

### 4.1 Envelope

```json
{
  "v": 1,
  "t": "<message_type>",
  "ch": "<channel-id>",
  "ts": 1779170000000,
  "from": "<base64url-pubkey-or-_adapter>",
  "body": { }
}
```

| Field  | Required | Description |
|--------|----------|-------------|
| `v`    | yes | Protocol version. MUST be `1`. |
| `t`    | yes | Message type. |
| `ch`   | yes | Channel ID (hex, 64 chars). |
| `ts`   | yes | Sender timestamp (ms, Unix epoch). Informational only. |
| `from` | yes | Sender identity. |
| `body` | yes | Type-specific payload. |

`ts` is not a security input. Receivers MUST NOT reject messages solely
based on `ts`. Replay detection uses sequence counters (Section 6.4).
The relay MAY reject `ts` deviating more than 5 minutes from server time
as an availability heuristic.

### 4.2 Body Schemas

All listed fields are required. Use `null` when not applicable.

| `t` | `body` fields |
|-----|---------------|
| `create` | `meta` |
| `join` | `sealed_join` |
| `accept` | `target` |
| `ready` | `state`, `role`, `self`, `remote`, `reconnect` |
| `req` | `id`, `sealed` |
| `res` | `id`, `sealed` |
| `evt` | `id`, `sealed` |
| `ping` | (empty object) |
| `pong` | (empty object) |
| `close` | `reason` |
| `terminate` | `reason` |

| Field | In `body` of | Description |
|-------|-------------|-------------|
| `meta` | `create` | Display metadata: `name`, `description`, `url`, `icon`. All required. |
| `sealed_join` | `join` | Encrypted capabilities and metadata (base64url). See §6.5. |
| `reconnect` | `ready` | Boolean. `true` if this is a reconnect, `false` on first connection. |
| `target` | `accept` | Wallet public key (base64url). |
| `state` | `ready` | `"waiting"` or `"connected"`. |
| `role` | `ready` | `"dapp"` or `"wallet"`. |
| `self` | `ready` | Local peer public key (base64url). |
| `remote` | `ready` | Remote peer public key (base64url). `null` when `state` is `"waiting"`. |
| `id` | `req`, `res`, `evt` | Request or event ID. |
| `sealed` | `req`, `res`, `evt` | Encrypted payload (base64url). See §6.4. |
| `reason` | `close`, `terminate` | Close or termination reason (§12). |

### 4.3 Sealed Payload Content

The `sealed` field contains encrypted JSON. Method and event names are
inside the encrypted payload, never in plaintext on the wire.

| Message type | Decrypted content |
|-------------|-------------------|
| `req` | `{ "_method": "<name>", ...params }` |
| `res` (success) | `{ "_ok": true, "_result": <value> }` |
| `res` (error) | `{ "_ok": false, "code": "<code>", "message": "<text>" }` |
| `evt` | `{ "_event": "<name>", ...data }` |

- `_method` is required in `req`. `_event` is required in `evt`. If
  missing, reject with `invalid_params`.
- `_ok` is required in all `res`. If missing, reject with
  `protocol_error`.
- `_result` may be any JSON value including `null`.
- Every `req`, `res`, and `evt` MUST carry `sealed` after
  `ready.connected`. A message without `sealed` MUST be rejected.

## 5. Message Types

Peer-sent:

| Type | Direction | Purpose |
|------|-----------|---------|
| `create` | dApp → adapter | Create channel |
| `join` | wallet → dApp | Join channel |
| `accept` | dApp → wallet | Accept wallet |
| `req` | dApp → wallet | Encrypted request |
| `res` | wallet → dApp | Encrypted response |
| `evt` | wallet → dApp | Encrypted event |
| `ping` | either → peer | Heartbeat |
| `pong` | either → peer | Heartbeat reply |
| `close` | either → peer | Close or reject |

Adapter-sent:

| Type | Direction | Purpose |
|------|-----------|---------|
| `ready` | adapter → peer | Channel state notification |
| `terminate` | adapter → peer | Forced termination |

There is no separate `error` message. Request errors use `_ok = false`
inside encrypted `res`. Channel errors use `close`. Adapter shutdown
uses `terminate`.

## 6. Key Exchange and Encryption

### 6.1 Key Exchange

Both peers generate an ephemeral X25519 key pair per channel.

1. DApp generates key pair, embeds public key in pairing URI.
2. Wallet obtains dApp public key from pairing URI.
3. Wallet sends `join` with its public key in `from`.
4. DApp receives `join`, obtains wallet public key from `from`.
5. Both sides independently derive all keys.

### 6.2 Key Derivation

```text
shared_secret = X25519(local_private_key, remote_public_key)

root_key = HKDF-SHA256(
  ikm  = shared_secret,
  salt = channel_id_bytes,         // 32 bytes from hex
  info = "walletpair-v1 root"
)[0:32]
```

Transcript hash (computed after `join` is received by dApp / sent by
wallet):

```text
lp(s) = uint16_be(byte_length(utf8(s))) || utf8(s)

transcript_hash = SHA256(
  "walletpair-v1-transcript" ||
  channel_id_bytes ||
  lp(dapp_pubkey_base64url) ||
  lp(wallet_pubkey_base64url) ||
  lp(canonical_json(capabilities or null)) ||
  lp(canonical_json(meta or null)) ||
  lp(dapp_name_from_pairing_uri or "")
)
```

Where `capabilities` and `meta` are from the decrypted `sealed_join`.

Direction-specific traffic keys:

```text
dapp_to_wallet_key = HKDF-SHA256(
  ikm  = root_key,
  salt = transcript_hash,
  info = "walletpair-v1 dapp-to-wallet"
)[0:32]

wallet_to_dapp_key = HKDF-SHA256(
  ikm  = root_key,
  salt = transcript_hash,
  info = "walletpair-v1 wallet-to-dapp"
)[0:32]
```

`req` uses `dapp_to_wallet_key`. `res` and `evt` use
`wallet_to_dapp_key`. The same key MUST NOT be used in both directions.

Join encryption key (for `sealed_join`, available before `join`):

```text
join_encryption_key = HKDF-SHA256(
  ikm  = root_key,
  salt = channel_id_bytes,
  info = "walletpair-v1 join-encryption"
)[0:32]
```

#### Canonical JSON

Deterministic JSON serialization, compatible with RFC 8785 (JCS):

1. Object keys sorted lexicographically by UTF-8 bytes (recursive).
2. No insignificant whitespace.
3. `undefined` → `null`.
4. Numbers: shortest decimal, no trailing zeroes, no leading zeroes,
   no `+` prefix, negative zero → `0`.
5. Strings: `\uXXXX` only for control characters (U+0000–U+001F).
   Mandatory JSON escapes use short form. `/` MUST NOT be escaped.
6. `null`, `true`, `false` use literal forms.

Test vector:

```text
Input:  {"methods":["wallet_signTransaction","wallet_signMessage"],
         "events":["accountsChanged","chainChanged"],
         "chains":["eip155:1","eip155:137"]}
Output: {"chains":["eip155:1","eip155:137"],"events":["accountsChanged","chainChanged"],"methods":["wallet_signTransaction","wallet_signMessage"]}
SHA-256: 4da366e2aae26b47b3d90fff52410752348733350ce2525dce7d64510f571333
```

```text
Input:  null        →  Output: null
Input:  {"name":"MyWallet"}  →  Output: {"name":"MyWallet"}
```

#### Key Erasure

- `shared_secret`: erase after `root_key` is derived.
- `root_key`: erase after `join_encryption_key` and traffic keys are
  derived.
- `join_encryption_key`: erase after `sealed_join` encrypt/decrypt.
- `transcript_hash`: erase after traffic keys are derived.
- Traffic keys: persist for channel lifetime, erase on close.
- All erasure MUST overwrite memory with zeroes before deallocation.

### 6.3 Session Fingerprint

```text
fp_bytes    = SHA256(
  "walletpair-v1-session-fingerprint" ||
  channel_id_bytes ||
  dapp_pubkey_bytes
)[0:4]
fp_uint32   = big-endian uint32(fp_bytes)
fingerprint = fp_uint32 mod 10000    // zero-pad to 4 digits
```

Both peers compute this independently from the pairing URI (no message
exchange needed).

Display flow:

1. DApp displays fingerprint alongside QR code.
2. Wallet computes same fingerprint, displays in confirmation dialog.
3. User verifies match, confirms. Wallet sends `join`.

### 6.4 Message Encryption

After `ready.connected`, all `req`, `res`, and `evt` payloads are
encrypted with ChaCha20-Poly1305:

```text
nonce   = HMAC-SHA256(traffic_key, seq_bytes)[0:12]
aad     = channel_id_bytes || aad_header
sealed  = AEAD_encrypt(traffic_key, nonce, plaintext_json_utf8, aad)
envelope = base64url_no_pad(seq_bytes || ciphertext || tag)
```

AAD header (length-prefixed to prevent delimiter ambiguity):

```text
lp(s) = uint16_be(byte_length(utf8(s))) || utf8(s)

req:  aad_header = 0x01 || lp(from) || lp(id)
res:  aad_header = 0x02 || lp(from) || lp(id)
evt:  aad_header = 0x03 || lp(from) || lp(id)
```

The type byte binds `t`+`v` (bytes `0x01`-`0x03` are for protocol
version 1). `ch` is bound via `channel_id_bytes` in the AAD prefix.
`lp()` uses uint16_be length prefix (max 65535 UTF-8 bytes per field).

#### Sequence Numbers

`seq_bytes` is a 4-byte big-endian counter. Each peer maintains its own
send counter starting at 0, incrementing by 1 per `sealed` message.

The receiver tracks the highest accepted sequence number (initially -1).
A message MUST be rejected if its sequence number is not strictly greater
than the last accepted value. Gaps are valid (expected after reconnect).

Sequence counters persist across reconnects and MUST NEVER be reset.

If a send counter reaches `2^31` (2,147,483,648), the peer MUST close
with reason `normal` and require fresh pairing.

### 6.5 Encrypted Join (sealed_join)

The wallet encrypts capabilities and metadata in `body.sealed_join`:

```text
join_plaintext = canonical_json({"capabilities": {...}, "meta": {...}})
join_nonce     = random_96_bits()
join_aad       = channel_id_bytes || 0x04
sealed_join    = AEAD_encrypt(join_encryption_key, join_nonce,
                              join_plaintext, join_aad)
envelope       = base64url_no_pad(join_nonce || ciphertext || tag)
```

- Nonce: fresh random 96-bit per encryption. MUST NOT reuse.
- AAD type byte `0x04` is reserved for `sealed_join`.
- Minimum decoded envelope length: 12 + 16 bytes.
- On retry: MUST use fresh nonce, MUST NOT change capabilities or
  metadata.

DApp processing:

1. Compute `shared_secret`, `root_key`, `join_encryption_key` from
   wallet's `from` key.
2. Parse first 12 bytes as nonce, decrypt remainder.
3. Decryption failure → close with `decryption_failed`.
4. Use decrypted capabilities and meta for transcript hash and traffic
   key derivation.

## 7. Capability Negotiation

The wallet declares its granted session scope inside `sealed_join`:

```json
{
  "capabilities": {
    "methods": ["wallet_signTransaction", "wallet_signMessage"],
    "events": ["accountsChanged", "chainChanged"],
    "chains": ["eip155:1", "eip155:137"]
  },
  "meta": {
    "name": "MyWallet",
    "description": "A multi-chain wallet",
    "url": "https://mywallet.app",
    "icon": "https://mywallet.app/icon.png"
  }
}
```

**`capabilities` fields** (all required, empty array = none):

| Field | Type | Description |
|-------|------|-------------|
| `methods` | string[] | Methods authorized for this session. |
| `events` | string[] | Event types the wallet may push. |
| `chains` | string[] | CAIP-2 chains authorized for this session. |

**`version` field** (optional):

```json
{ "version": { "evm": 1 } }
```

Maps sub-protocol namespace to integer version. If absent, assume
version 1 for all declared namespaces.

**Wallet `meta` fields** (all required):

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Wallet display name. |
| `description` | yes | Short description. |
| `url` | yes | Wallet website URL. |
| `icon` | yes | Wallet icon URL. MUST be `https:`. |

### 7.1 Scope Enforcement

The pairing URI `methods` and `chains` declare the dApp's minimum
requirements. The wallet's `capabilities` declares the granted scope.

**Wallet side:**

- MUST check it can satisfy dApp's requirements from the pairing URI.
- SHOULD warn user if it cannot satisfy a required method or chain.
- MAY grant additional methods/chains beyond what was requested.
- MUST display granted scope for user confirmation before `join`.
- If pairing URI omits `methods`/`chains`, MUST warn user that the
  dApp did not declare intent.

**DApp side:**

- MUST check if granted capabilities satisfy its requirements. If
  not, SHOULD close with `unsupported_capability`.
- MUST adapt to granted capabilities (e.g., fall back to sign-only
  if `wallet_sendTransaction` not granted).
- MUST NOT call methods not in `capabilities.methods`.

**Runtime enforcement (wallet):**

1. Reject `req` with method not in `capabilities.methods` →
   `unsupported_method`.
2. Reject requests targeting chain not in `capabilities.chains` →
   `unsupported_chain`.
3. Only expose accounts authorized for this session.

Account authorization is revealed only through encrypted methods
(e.g., `wallet_getAccounts`), not in the `join` message.

## 8. Pairing Flow

### 8.1 Pairing URI

```text
walletpair:?ch=<channel-id>&pubkey=<dapp-pubkey-base64url>&relay=<relay-url-percent-encoded>&name=<dapp-name>&url=<dapp-url>&icon=<icon-url>&methods=<comma-list>&chains=<comma-list>
```

| Param | Required | Description |
|-------|----------|-------------|
| `ch` | yes | Channel ID (hex, 64 chars). |
| `pubkey` | yes | DApp X25519 public key (base64url, no padding). |
| `relay` | yes (relay transport) | WebSocket relay URL (percent-encoded). May repeat for multiple relays. |
| `name` | yes | DApp display name. |
| `url` | yes | DApp website URL (percent-encoded). |
| `icon` | yes | DApp icon URL (percent-encoded). MUST be `https:`. |
| `methods` | optional | Comma-separated required methods. |
| `chains` | optional | Comma-separated required CAIP-2 chains. |

The pairing URI MUST be delivered through a channel where a network
attacker or relay cannot substitute the content:

| Delivery method | Status |
|----------------|--------|
| QR code (optical scan) | **REQUIRED** support. |
| Deep link / URL scheme | **MUST NOT** be sole pairing mechanism. Wallet MUST display security warning. |
| Copy-paste | **MUST NOT** be sole pairing mechanism. |

DApps MUST display the session fingerprint (§6.3) alongside the QR
code.

### 8.2 Pairing Sequence

**Step 1: DApp creates channel.**

```json
{
  "v": 1, "t": "create",
  "ch": "aabb01...eeff", "ts": 1779170000000,
  "from": "<dapp-pubkey>",
  "body": {
    "meta": { "name": "MyDApp", "description": "...",
              "url": "https://mydapp.com",
              "icon": "https://mydapp.com/icon.png" }
  }
}
```

DApp `meta` fields: `name`, `description`, `url`, `icon` (all
required). This metadata is plaintext and visible to the relay.

Adapter replies with `ready`:
`{ "state": "waiting", "role": "dapp", "self": "<dapp-pubkey>", "remote": null, "reconnect": false }`

**Step 2: Wallet joins.**

Wallet scans QR, computes fingerprint, displays scope and fingerprint
for user confirmation. After user confirms, wallet sends:

```json
{
  "v": 1, "t": "join",
  "ch": "aabb01...eeff", "ts": 1779170000000,
  "from": "<wallet-pubkey>",
  "body": {
    "sealed_join": "<base64url-encrypted>"
  }
}
```

Adapter forwards `join` to dApp and replies to wallet with
`ready.waiting`.

**Step 3: DApp accepts.**

DApp decrypts `sealed_join`. Successful decryption authenticates the
wallet (it obtained dApp's public key from QR code). DApp MAY
auto-accept.

```json
{
  "v": 1, "t": "accept",
  "ch": "aabb01...eeff", "ts": 1779170000000,
  "from": "<dapp-pubkey>",
  "body": { "target": "<wallet-pubkey>" }
}
```

**Step 4: Connected.**

Adapter sends `ready.connected` to both peers:
`{ "state": "connected", "role": "<role>", "self": "<own-pubkey>", "remote": "<peer-pubkey>", "reconnect": false }`

Both peers initialize send and receive sequence counters to 0. All
subsequent `req`, `res`, `evt` MUST be encrypted.

## 9. Request and Response

```json
{
  "v": 1, "t": "req",
  "ch": "...", "ts": ..., "from": "<dapp-pubkey>",
  "body": { "id": "req-001", "sealed": "<encrypted>" }
}
```

Rules:

1. Only the dApp sends `req`. Only the wallet sends `res`.
2. `res.id` MUST equal the matching `req.id`.
3. Each request receives exactly one response.
4. The decrypted `req.sealed` is `{ "_method": "<name>", ...params }`.
   The decrypted `res.sealed` contains `_ok` and either `_result` or
   `code`/`message`.

### 9.1 Request Idempotency

The wallet MUST cache processed requests to handle retries:

- **Cache:** Store request ID, params hash, and response for at least
  the most recent **1024** requests (LRU eviction). Individual cached
  responses MUST NOT exceed **16 KB**; oversized responses are flagged
  as uncacheable and re-processed on retry.
- **Params hash:** `SHA-256(plaintext_json_utf8)` of the raw decrypted
  bytes (before parsing). The dApp MUST reuse the exact bytes when
  retrying.
- **Cache hit, same params:** Return cached response, re-encrypted
  with fresh sequence number. MUST NOT replay old `sealed` bytes.
- **Cache hit, different params:** Reject with `invalid_params`.
- **Cache miss (evicted):** Process as new request.

**Broadcast idempotency** (`wallet_sendTransaction` only): Persist
broadcast tx hashes separately (keyed by `req.id`, max **256** entries,
LRU). Never re-broadcast for a cached `req.id`.

**Cache security:** Store in non-swappable memory or encrypt at rest.
Securely erase (zero) on channel close.

## 10. Events

The wallet pushes events to the dApp with `evt`:

```json
{
  "v": 1, "t": "evt",
  "ch": "...", "ts": ..., "from": "<wallet-pubkey>",
  "body": { "id": "evt-001", "sealed": "<encrypted>" }
}
```

Rules:

1. Only the wallet sends `evt`.
2. Events do not require a response.
3. Event ordering follows transport order while connected.
4. No event replay guarantee after reconnect. The dApp SHOULD call a
   snapshot method (e.g., `wallet_getAccounts`) after reconnect.

## 11. Heartbeat

Either peer may send `ping`. The receiver replies with `pong`.

```json
{ "v": 1, "t": "ping", "ch": "...", "ts": ..., "from": "<pubkey>", "body": {} }
{ "v": 1, "t": "pong", "ch": "...", "ts": ..., "from": "<pubkey>", "body": {} }
```

Heartbeats are not encrypted and do not consume sequence numbers.

Recommended: ping every 30 seconds, timeout after 60 seconds of no
pong. On timeout, treat connection as dead and begin reconnect (§13).

## 12. Close and Terminate

### 12.1 Close (peer-initiated)

```json
{ "v": 1, "t": "close", "ch": "...", "ts": ...,
  "from": "<pubkey>", "body": { "reason": "normal" } }
```

### 12.2 Terminate (adapter-initiated)

```json
{ "v": 1, "t": "terminate", "ch": "...", "ts": ...,
  "from": "_adapter", "body": { "reason": "timeout" } }
```

Only the adapter sends `terminate`. Peers MUST NOT send it.

### 12.3 Reasons

| Reason | Used by | Meaning |
|--------|---------|---------|
| `normal` | P | Normal close. |
| `user_rejected` | P | User rejected the wallet or closed channel. |
| `unsupported_capability` | P | Missing required chain or method. |
| `unsupported_version` | P | Unsupported `v` value. |
| `decryption_failed` | P | Could not decrypt `sealed`. |
| `channel_not_found` | A | Channel does not exist. |
| `channel_exists` | A | Channel ID already in use. |
| `already_connected` | A | Channel already has both peers. |
| `invalid_state` | P, A | Message not allowed in current state. |
| `invalid_role` | P, A | Message not allowed for sender's role. |
| `timeout` | P, A | Heartbeat, pairing, or session lifetime timeout. |
| `rate_limited` | P, A | Too many pending requests or messages. |
| `payload_too_large` | P, A | Message exceeds 64 KB. |
| `protocol_error` | P, A | Malformed or unsupported message. |

P = peer, A = adapter.

## 13. Reconnect

The relay is stateless. There are no resume tokens. Reconnect works by
re-running the pairing handshake on the same channel ID.

**DApp reconnects** by re-sending `create` (same `ch`):

```json
{ "t": "create", "body": { "meta": { "name": "MyDApp" } } }
```

**Wallet reconnects** by re-sending `join` (same `ch`):

```json
{ "t": "join", "body": { "sealed_join": "<base64url-encrypted>" } }
```

The relay recognizes the `ch` + `from` pair from the existing channel
and treats the message as a reconnect. The `ready` message includes
`"reconnect": true` to distinguish from a fresh connection.

**Relay behavior:**

- Known `from` + other peer connected → `ready.connected` with
  `"reconnect": true` immediately.
- Known `from` + other peer disconnected → `ready.waiting` with
  `"reconnect": true`, then `ready.connected` when other peer
  reconnects.
- Unknown `from` for an existing channel → `terminate` with
  `already_connected`.

**After reconnect:**

- Traffic keys, sequence counters, and idempotency cache persist.
  Sequence counters MUST NEVER be reset.
- Gaps in sequence numbers are expected (in-flight messages lost during
  disconnect).
- The dApp MAY retry pending requests with the same `req.id`.
- The dApp SHOULD refresh state (e.g., `wallet_getAccounts`).

**Sequence counter persistence:** Counters MUST be persisted durably
(write-ahead: persist before send). If persistence is lost (crash,
corruption), the peer MUST NOT reconnect — MUST close and re-pair.

**Reconnect backoff:** 1s → 2s → 5s → 10s → 30s.

**Simultaneous reconnect:** The relay MUST serialize reconnect
handling per channel ID to prevent race conditions.

## 14. State Machine

### DApp

```text
idle
  → send create ──────────────────────────→ waiting
waiting
  → receive join ─────────────────────────→ pending_accept
  → receive close/terminate ──────────────→ closed
  → timeout ──────────────────────────────→ closed
pending_accept
  → sealed_join verified → send accept ───→ connected
  → reject → send close ─────────────────→ closed
  → receive terminate ───────────────────→ closed
connected
  → send req / receive res,evt / ping,pong
  → send close ──────────────────────────→ closed
  → receive close/terminate ─────────────→ closed
  → transport disconnected ──────────────→ disconnected
  → session expired ─────────────────────→ closed
disconnected
  → send create (same ch) ───────────────→ waiting
  → session expired ─────────────────────→ closed
  → give up ─────────────────────────────→ closed
closed (terminal)
```

### Wallet

```text
idle
  → send join ───────────────────────────→ waiting_accept
waiting_accept
  → receive ready.connected ─────────────→ connected
  → receive close/terminate ─────────────→ closed
  → timeout ─────────────────────────────→ closed
connected
  → receive req / send res,evt / ping,pong
  → send close ──────────────────────────→ closed
  → receive close/terminate ─────────────→ closed
  → transport disconnected ──────────────→ disconnected
  → session expired ─────────────────────→ closed
disconnected
  → send join (same ch) ─────────────────→ waiting_accept
  → session expired ─────────────────────→ closed
  → give up ─────────────────────────────→ closed
closed (terminal)
```

## 15. Protocol Rules

1. A channel is created by the dApp.
2. A channel is joined by the wallet.
3. The dApp must accept the wallet before connected state.
4. A channel has at most one dApp and one wallet.
5. Only the dApp sends `req`.
6. Only the wallet sends `res` and `evt`.
7. `req`, `res`, `evt` are valid only after `ready.connected`.
8. After `ready.connected`, payloads MUST be encrypted in `sealed`.
9. Reconnect re-uses the same `ch` and `from`; no tokens needed.
10. A closed channel carries no more messages.
11. Maximum message size: 64 KB on the wire.
12. Maximum pending (unanswered) requests per channel: **32**. Excess
    requests → `rate_limited`.
13. Unsupported `v` value → `close` with `unsupported_version` (peer)
    or `terminate` (adapter).
14. Sequence counters MUST NEVER be reset.
15. Each peer MUST locally verify encrypted messages come from the
    expected remote peer public key.
16. A peer MUST reject `ready.connected` if `remote` does not match
    the peer key used in the handshake transcript.
17. **Session expiry.** Maximum lifetime: 24 hours from
    `ready.connected` (recommended default). Both peers MUST track
    start time and close with `timeout` on expiry. Reconnect with
    reconnect MUST NOT work after expiry — fresh pairing required.
    Implementations MAY allow shorter lifetimes but MUST NOT allow
    unlimited sessions.

## 16. Transport Requirements

A transport adapter MUST provide:

1. Bidirectional, ordered delivery while connected.
2. Channel creation by dApp.
3. Wallet join delivery to dApp.
4. `ready` messages to both peers.
5. State enforcement per §14.
6. Role enforcement per §2.
7. Heartbeat timeout handling.
8. Reconnect handling (re-identify peer by `ch` + `from`).

## 17. WebSocket Relay Binding

### 17.1 Connection

```text
Endpoint:     wss://relay.example.com/v1
Subprotocol:  walletpair.v1
```

### 17.2 Relay Behavior

The relay MUST:

1. Accept WalletPair JSON over WebSocket text frames.
2. Track channel state in memory (no persistent storage required).
3. On `create`: create channel, reply `ready.waiting`.
4. On `join`: forward to dApp, reply `ready.waiting` to wallet.
5. On `accept`: send `ready.connected` to both peers.
6. Forward `req` to wallet only after `ready.connected`.
7. Forward `res`/`evt` to dApp only after `ready.connected`.
8. Reject invalid state/role transitions with `terminate`.
9. On reconnect: re-identify peer by `ch` + `from`, set `reconnect: true` in `ready`.
10. Verify `from` matches original participant on reconnect.
11. Expire channels: 5 min unpaired, 24 hours connected (recommended).

The relay MUST NOT:

1. Require authentication, registration, or API keys.
2. Inspect, log, or store `sealed` content beyond immediate delivery.

### 17.3 Rate Limiting

The relay MUST enforce non-zero limits in all categories:

| Limit | Recommended |
|-------|-------------|
| Channel creation per IP | 10/min |
| Concurrent connections per IP | 50 |
| Messages per channel per peer | 60/min |
| Global concurrent channels | 10,000 |
| Global bandwidth | 100 MB/min |
| Maximum message size | 64 KB (per §15 rule 11) |

### 17.4 Multiple Relays

When the pairing URI lists multiple `relay` parameters:

- DApp MUST create the channel on all listed relays.
- Wallet tries relays in order, uses first that connects.
- Switching relays does not affect encryption (keys derive from peer
  keys, not relay).
- After pairing completes on one relay, dApp MUST close channels on
  other relays (`close` with `normal`).
- Resume tokens are relay-specific. If the active relay fails, both
  peers MUST fall back to fresh pairing.

## 18. Bluetooth Binding

### 18.1 Overview

In Bluetooth mode, there is no relay. The BLE stack acts as the
transport adapter. The dApp still owns the channel. Protocol messages
are identical; only the transport changes.

### 18.2 Discovery

DApp creates channel and exposes pairing URI via QR code (without
`relay` parameter). Wallet scans QR.

### 18.3 BLE GATT Service

```text
Service UUID: 0000FE70-0000-1000-8000-00805F9B34FB
  Channel (read):   0000FE71-0000-1000-8000-00805F9B34FB
  Message (write):  0000FE72-0000-1000-8000-00805F9B34FB
  Message (notify): 0000FE73-0000-1000-8000-00805F9B34FB
```

Production deployments SHOULD register with Bluetooth SIG or use
fully random 128-bit UUIDs.

### 18.4 Flow

1. DApp creates `ch`. BLE adapter returns `ready.waiting`.
2. DApp exposes pairing URI via QR code.
3. Wallet scans, computes fingerprint, user verifies and confirms.
4. Wallet sends `join` with `sealed_join`.
5. BLE adapter forwards `join` to dApp, sends `ready.waiting` to
   wallet.
6. DApp verifies `sealed_join`, sends `accept`.
7. BLE adapter sends `ready.connected` to both.
8. Encrypted `req`/`res`/`evt` flow begins.

### 18.5 Message Framing

```text
[1 byte flags] [2 bytes total_length big-endian] [payload fragment]

flags:
  bit 0: 1 = first fragment
  bit 1: 1 = last fragment
  bits 2-7: reserved
```

`total_length` is meaningful only in the first fragment (max 65535).
Subsequent fragments set it to 0.

Limits:

| Constraint | Value |
|-----------|-------|
| Fragment timeout | 5 seconds from first fragment |
| Max fragments per message | 256 |
| Max total length | 65535 bytes |
| Fragment payload size | negotiated_MTU - 3 (default: 20 bytes) |

Out-of-order fragments → discard all buffered fragments.
Implementations MUST use indications (not notifications) or add
fragment-level sequencing.

## 19. Security

### 19.1 Threat Model

The relay or transport may be compromised. It MUST NOT be able to:

- read request parameters, response results, or event data
- impersonate a peer
- replay messages to cause duplicate signing

### 19.2 Protections

| Threat | Protection |
|--------|-----------|
| Eavesdropping | E2E encryption (X25519 + ChaCha20-Poly1305). |
| Man-in-the-middle | Out-of-band key delivery (QR); session fingerprint (§6.3); `sealed_join` binds wallet to QR-scanned key. |
| Peer impersonation | Peer ID = X25519 public key; relay verifies on reconnect. |
| Replay | Sequence-number nonce; reject non-increasing seq. |
| Channel hijack | Channel ID = 256-bit random. |
| Relay compromise | Relay sees only encrypted blobs and routing metadata. `_ok` status is encrypted. |

### 19.3 Rules

1. `ch` MUST be 256-bit cryptographically random.
2. `from` MUST match sender's X25519 public key.
3. Reconnect relies on `ch` + `from` identity, not tokens.
4. Ephemeral key pairs MUST be generated per channel.
5. Reject messages with non-increasing sequence numbers.
6. Relay MUST NOT log or store `sealed` content.
7. Sequence counters MUST NEVER be reset for a given traffic key.

### 19.4 Privacy

Visible to relay: `ch`, `from`, `t`, `ts`.

Encrypted and invisible to relay:

- Capabilities and metadata (in `sealed_join`).
- Method and event names (inside `sealed`).
- Response success/failure (`_ok` inside `sealed`).

### 19.5 Icon URL Safety

`meta.icon` URLs may be used for tracking. Implementations SHOULD:

- Not load remote URLs automatically, or
- Load through a privacy proxy, or
- Only load `https:` URLs and warn on other schemes.

## Appendix A: Cryptographic Test Vectors

All hex values are lowercase. Base64url uses no padding.

**WARNING:** Private keys below are for testing only.

### A.1 Key Material

```text
dapp_private_key     = a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4
dapp_public_key      = 1c9fd88f45606d932a80c71824ae151d15d73e77de38e8e000852e614fae7019
dapp_pub_base64url   = HJ_Yj0VgbZMqgMcYJK4VHRXXPnfeOOjgAIUuYU-ucBk

wallet_private_key   = 4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d
wallet_public_key    = ff63fe57bfbf43fa3f563628b149af704d3db625369c49983650347a6a71e00e
wallet_pub_base64url = _2P-V7-_Q_o_VjYosUmvcE09tiU2nEmYNlA0empx4A4

channel_id           = a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2
shared_secret        = 739311d35d8d3c41da4062c799a6c748808a31343facaaa7aa7e311908c1846e
```

### A.2 Key Derivation

```text
root_key             = c33b664ab3eea368d81109b432f04a1293a743212749e19bfe412a2996dcefee

join_encryption_key  = 981e75c4fad86e3db377517816a24b27564661ab89d327217684e0a56d68ec11
```

### A.3 Sealed Join

```text
join_plaintext canonical JSON:
{"capabilities":{"chains":["eip155:1","eip155:137"],"events":["accountsChanged","chainChanged"],"methods":["wallet_signTransaction","wallet_signMessage"]},"meta":{"name":"MyWallet"}}

join_nonce     = 09474eabe263432ebc7e4756
join_aad       = a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b204

ciphertext+tag = 1f21896b618b3413d711bfb4bcad479530a642b67011da91
                 45bd22c815fd6471a4bfbe0be89db82cc33601516cad757d
                 a637029ad2f1db57e48fabdeb3caddf91b63c96e964b8e3e
                 aa8f3bb27dfa2292e3848b6e523abf7a50d4affa823a9c21
                 a1522b142dbd6fb9fff6af1475b3007791f074a3622852eb
                 6fdd7fad68558f71ffcbbf1fc9fb7c2e21dbe76a74c85d91
                 581e66d3ebd987403d464f4704bf5a9ac10f9ce428ce4869
                 5abce7b95910d662d4e17004874fc8a457a3983a8a5e11f1
                 e6d028de7389

sealed_join base64url = CUdOq-JjQy68fkdWHyGJa2GLNBPXEb-0vK1HlTCmQrZwEdqRRb0iyBX9ZHGkv74L6J24LMM2AVFsrXV9pjcCmtLx21fkj6ves8rd-RtjyW6WS44-qo87sn36IpLjhItuUjq_elDUr_qCOpwhoVIrFC29b7n_9q8UdbMAd5HwdKNiKFLrb91_rWhVj3H_y78fyft8LiHb52p0yF2RWB5m0-vZh0A9Rk9HBL9amsEPnOQozkhpWrznuVkQ1mLU4XAEh0_IpFejmDqKXhHx5tAo3nOJ
```

### A.4 Transcript and Traffic Keys

```text
capabilities JSON = {"chains":["eip155:1","eip155:137"],"events":["accountsChanged","chainChanged"],"methods":["wallet_signTransaction","wallet_signMessage"]}
meta JSON         = {"name":"MyWallet"}
dapp_name         = MyDApp

transcript_hash    = 51d1797d9ab563c1d26e033af2bf8fa17c741af5f6c0d4071e69dfd25ce8d39f
dapp_to_wallet_key = 782ccebad576c74dede0ba376a324d06b6aa7008b90116bc57c693171c41c074
wallet_to_dapp_key = 26bb36c7e36a29df7b92cee30a6b16a09964b3b74833d0b742a2c01b4ab8c925
```

### A.5 Session Fingerprint

```text
SHA256("walletpair-v1-session-fingerprint" || channel_id_bytes || dapp_pubkey_bytes)
= 7f301a56626650b08f11c99df3333237a66fae34e0c0d1512c19fe51d41a8604

fp_bytes  = 7f301a56
fp_uint32 = 2133858902
fingerprint = 8902
```

### A.6 AEAD Encryption (dapp→wallet, seq=0)

```text
traffic_key = 782ccebad576c74dede0ba376a324d06b6aa7008b90116bc57c693171c41c074
seq_bytes   = 00000000
nonce       = 8e8a6459ee942cc99709de1e

from = "HJ_Yj0VgbZMqgMcYJK4VHRXXPnfeOOjgAIUuYU-ucBk"
id   = "req-001"

aad_header = 01002b484a5f596a305667625a4d71674d63594a4b345648525858506e66654f4f6a674149557559552d7563426b00077265712d303031

plaintext = {"_method":"wallet_getAccounts","chain":"eip155:1"}

ciphertext+tag = ce3fe8bcf32e130e002ea8a9029d5457f4ee2978220af0b9
                 eff01361f788df6f50e8b281378ed1bc48b13516844b787b
                 784474b4bd8301b7ed97d52515d535ce223a79

sealed = AAAAAM4_6LzzLhMOAC6oqQKdVFf07il4Igrwue_wE2H3iN9vUOiygTeO0bxIsTUWhEt4e3hEdLS9gwG37ZfVJRXVNc4iOnk
```
