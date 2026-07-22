# Encryption Protocol

## Security goal

Each channel has exactly two cryptographic peers:

- **A — DApp:** creates the channel.
- **B — Wallet:** joins the channel.

Subject to the pairing assumptions below, the protocol authenticates the DApp to the Wallet. The DApp does not authenticate the Wallet: it pins the first `channel_joined` participant whose public key differs from its own. Later participants may remain connected to the relay, but both peers ignore their events and any ciphertext that does not verify with the pinned directional key. A participant that joins first can therefore deny service, but cannot impersonate the DApp to the Wallet or decrypt Wallet messages.

Each peer generates a fresh ephemeral X25519 key pair for every channel. Public keys use canonical unpadded base64url and decode to exactly 32 bytes. `channel_id_bytes` is the 32-byte value decoded from the 64-character lowercase hexadecimal `ch`.

## DApp pairing

The DApp displays this URI as a QR code:

```text
walletpair:?ch=<channel-id>&pubkey=<dapp-pubkey-base64url>&relay=<relay-url-percent-encoded>&name=<dapp-name>&url=<dapp-url>&icon=<icon-url>
```

All six query keys MUST occur exactly once. `ch` and `pubkey` use their canonical encodings above. The UTF-8 values of `relay`, `name`, `url`, and `icon` MUST be RFC 3986 percent-encoded when serialized and decoded exactly once when parsed. Duplicate required keys, malformed percent encoding, or invalid UTF-8 MUST be rejected. Fingerprint inputs are the decoded strings exactly as received; implementations MUST NOT apply URL canonicalization or Unicode normalization before hashing.

The DApp MUST use the same `ch`, `name`, `url`, `icon`, and `pubkey` values in this URI and in its relay connection. Those five values MUST satisfy the [relay connection validation](./relay.md#connection). The decoded `relay` MUST be an absolute `ws:` or `wss:` URL for the relay WebSocket endpoint.

The Wallet obtains the DApp channel, metadata, relay URL, and public key by scanning the QR code. The DApp obtains the Wallet metadata and public key from the first eligible `channel_joined` event. The relay URL selects transport but is intentionally not one of the five fingerprint fields.

Define:

```text
lp(s) = uint16_be(byte_length(utf8(s))) || utf8(s)
```

An implementation MUST reject any `lp()` input longer than 65,535 UTF-8 bytes.

Both sides independently compute the DApp pairing code from the decoded URI values:

```text
dapp_fingerprint = SHA256(
  utf8("walletpair-v1-dapp-fingerprint") ||
  channel_id_bytes ||
  lp(dapp_name) ||
  lp(dapp_url) ||
  lp(dapp_icon) ||
  lp(dapp_pubkey_base64url)
)

pairing_code = zero_pad_4(uint32_be(dapp_fingerprint[0:4]) mod 10000)
```

The user compares the four digits shown by the DApp page and Wallet. A match lets the Wallet enter the `paired` state and pin the DApp public key from the QR code. A mismatch aborts the channel; retrying requires a fresh channel ID and fresh X25519 keys.

If an attacker must commit replacement pairing data before learning the genuine code, its success probability is `1/10000` per independent attempt. This bound does not apply when an attacker learns the code first and can then choose replacement data: because every fingerprint input is public and the code has only 10,000 values, it can search offline for a collision in roughly 10,000 trials. This risk is accepted by this protocol; the four digits are a short human check, not cryptographic-strength authentication.

Subject to no four-digit collision, the comparison authenticates the five scanned fingerprint fields to the currently trusted DApp page. It does not authenticate `relay`, an already compromised page, or an untrusted standalone URI. Changing only `relay` can redirect or deny transport, but cannot produce ciphertext valid under the pinned DApp key.

No explicit `dapp_confirm` message is required, and the Wallet may send after entering `paired`. For an honest Wallet, the first valid A→B ciphertext provides implicit confirmation that its peer derived the same shared secret from the pinned DApp key.

## Key schedule

Each side computes:

```text
shared_secret = X25519(local_private_key, remote_public_key)
```

If `shared_secret` is 32 zero bytes, the peer MUST abort. The peers then derive:

```text
root_key = HKDF-SHA256(
  ikm  = shared_secret,
  salt = channel_id_bytes,
  info = utf8("walletpair-v1/root")
)[0:32]

transcript_hash = SHA256(
  utf8("walletpair-v1/transcript") ||
  channel_id_bytes ||
  lp(dapp_pubkey_base64url) ||
  lp(wallet_pubkey_base64url)
)

dapp_to_wallet_key = HKDF-SHA256(
  ikm  = root_key,
  salt = transcript_hash,
  info = utf8("walletpair-v1/dapp-to-wallet")
)[0:32]

wallet_to_dapp_key = HKDF-SHA256(
  ikm  = root_key,
  salt = transcript_hash,
  info = utf8("walletpair-v1/wallet-to-dapp")
)[0:32]
```

The two direction labels provide explicit domain separation. Implementations MUST erase `shared_secret` and `root_key` after deriving both traffic keys, and erase private and traffic keys when the channel closes, to the extent supported by the runtime.

## MessagePack profile

The encryption layer accepts only the JSON data model and encodes it as MessagePack:

- JSON `null`, booleans, strings, arrays, and objects map to the corresponding MessagePack types.
- Object keys MUST be unique UTF-8 strings. Map ordering has no meaning.
- Integers MUST be within `[-(2^53-1), 2^53-1]` and use the shortest MessagePack integer encoding.
- Other numbers MUST be finite and use MessagePack float64. `NaN` and infinities are forbidden.
- MessagePack binary, extension/timestamp values, non-string map keys, invalid UTF-8, and trailing bytes are forbidden.
- Encoded plaintext MUST NOT exceed 64 KiB and nesting depth MUST NOT exceed 64.

The exact MessagePack bytes are opaque to the relay and are not part of key derivation.

## Message protection

A uses `dapp_to_wallet_key`; B uses `wallet_to_dapp_key`. Each direction owns an independent send counter.

Every application frame carries a canonical [CAIP-2](https://standards.chainagnostic.org/CAIPs/caip-2) chain ID. It is an ASCII `namespace:reference` string of at most 41 bytes, such as `eip155:1`. The CAIP-2 value is public routing metadata, but it is authenticated by AEAD.

```text
seq_bytes = uint32_be(send_sequence)
direction = 0x01 for DApp→Wallet, 0x02 for Wallet→DApp
nonce     = 0x0000000000000000 || seq_bytes
aad       = utf8("walletpair-v1/aead") ||
            channel_id_bytes ||
            transcript_hash ||
            direction ||
            seq_bytes ||
            lp(caip2_chain_id)
plaintext = MessagePack_encode(json_message)

ciphertext_tag = ChaCha20-Poly1305_encrypt(
  traffic_key,
  nonce,
  plaintext,
  aad
)

sealed = base64url_no_pad(seq_bytes || ciphertext_tag)
frame  = sealed || "@" || caip2_chain_id
```

ChaCha20-Poly1305 uses a 32-byte key, 12-byte nonce, and full 16-byte tag. Tags MUST NOT be truncated. Canonical base64url and CAIP-2 never contain `@`, so `frame` has exactly one unambiguous separator.

### Decryption

1. Split `frame` at its single `@`; reject a missing/duplicate separator or a non-canonical CAIP-2 suffix.
2. Reject a non-canonical base64url `sealed` value or decoded value outside 20–65,556 bytes.
3. Split the first 4 decoded bytes as `seq_bytes`; reject a sequence number that is not strictly greater than the last accepted value.
4. Rebuild `nonce` and `aad`, including the received CAIP-2 suffix, then authenticate and decrypt with the receive-direction key.
5. Reject an AEAD failure without changing receive state.
6. Decode the plaintext with the JSON-only MessagePack profile; reject malformed, oversized, excessively nested, or trailing data.
7. Only after all checks succeed, atomically record the accepted sequence number and deliver the JSON value with its authenticated CAIP-2 chain ID.

Frames from later joiners cannot verify under the pinned receive-direction key and are silently discarded without changing the receive sequence number.

### Sequence persistence

Each send counter starts at `0` and increases once per sealed message. Each receive counter starts at `-1`; gaps are valid, while replayed and out-of-order values are rejected. Counters are per direction and traffic key, not per CAIP-2 chain: all chain suffixes in one channel share the same directional counter.

Before encrypting, the sender MUST atomically reserve and persist the next counter value. Counters persist across reconnects and MUST NOT reset while traffic keys are reused. If counter state cannot be recovered safely, the channel MUST be abandoned and paired again with fresh keys. Valid send values are `0` through `2^31-1`; before using `2^31`, the peer closes the channel and requires fresh pairing.

## Security properties and limits

- Subject to the pairing assumptions above, a passive observer or relay learns channel metadata, public keys, CAIP-2 chain IDs, timing, and ciphertext sizes, but not Wallet plaintexts or traffic keys.
- The Wallet accepts only messages authenticated with the direction key derived from the DApp public key pinned by QR pairing.
- The DApp deliberately provides no Wallet identity guarantee; a malicious first joiner may become its peer or cause denial of service.
- The relay and extra participants can drop, delay, replay, reorder, or inject frames. AEAD and sequence checks detect forgery and replay but cannot prevent denial of service.

## Formal verification

The [ProVerif model](../formal-verification/encryption.pv) represents an active attacker controlling the relay and permits an attacker to become the DApp's first joiner. With ideal X25519, HKDF, hashing, MessagePack, and AEAD primitives, ProVerif 2.05 proves:

- a successful, collision-free Wallet comparison binds all five fingerprint fields to an honest DApp display;
- every modeled A→B message and its public CAIP-2 suffix accepted by the Wallet has injective correspondence with a DApp send; and
- Wallet data sent immediately after pairing remains secret without `dapp_confirm`.

The proof treats the human comparison as authentic and collision-free. It does not prove the four-digit probability bound, parser and size checks, all-zero X25519 rejection, or persistent sequence-counter behavior. See the [model notes](../formal-verification/README.md) for the exact scope and reproduction command.
