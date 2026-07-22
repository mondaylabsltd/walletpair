# Encryption Protocol

## Scope and roles

Each channel has two peers: **A** and **B**. Their role order must be agreed by both peers (for example, channel creator = A and joiner = B). Each peer generates a fresh, ephemeral X25519 key pair for every channel. Public keys are unpadded base64url strings; `channel_id_bytes` is the 32-byte value decoded from the 64-character hexadecimal `ch`.

## Key schedule

```text
shared_secret = X25519(local_private_key, remote_public_key)

root_key = HKDF-SHA256(
  ikm  = shared_secret,
  salt = channel_id_bytes,
  info = "walletpair-root"
)[0:32]
```

`lp(s)` means `uint16_be(byte_length(utf8(s))) || utf8(s)`.

```text
transcript_hash_A = SHA256(
  "walletpair-transcript" ||
  channel_id_bytes ||
  lp(peer_A_pubkey_base64url) ||
  lp(peer_B_pubkey_base64url)
)

transcript_hash_B = SHA256(
  "walletpair-transcript" ||
  channel_id_bytes ||
  lp(peer_B_pubkey_base64url) ||
  lp(peer_A_pubkey_base64url)
)

peer_A_to_B_key = HKDF-SHA256(
  ikm  = root_key,
  salt = transcript_hash_A,
  info = ""
)[0:32]

peer_B_to_A_key = HKDF-SHA256(
  ikm  = root_key,
  salt = transcript_hash_B,
  info = ""
)[0:32]
```

The two peers compute the same `shared_secret` and `root_key`, but use different directional keys. After derivation, implementations should erase `shared_secret` and `root_key` from memory.

## Message protection

1. Encode the JSON application message as MessagePack.
2. A sends with `peer_A_to_B_key`; B sends with `peer_B_to_A_key`.
3. Encrypt with AEAD, using the sender's directional key. The receiver decrypts with that same directional key and rejects any failed integrity check.

The AEAD nonce must be unique for every use of a given directional key. The concrete AEAD algorithm, nonce format, and any associated data must be fixed by the enclosing message envelope before independent implementations can interoperate.

## Security property

An observer may know the channel ID, both public keys, and ciphertexts, but cannot derive `shared_secret` or decrypt messages. Only the two holders of the ephemeral private keys can derive the directional keys and read or write channel messages.
