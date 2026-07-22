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

After the channel is connected, every application message uses the sender's directional traffic key: A uses `peer_A_to_B_key`; B uses `peer_B_to_A_key`.

The encryption layer treats the application message as opaque data. The message is encoded as **MessagePack** before encryption; it does not inspect or distinguish application-level message types.

```text
seq_bytes      = uint32_be(send_sequence)
nonce          = HMAC-SHA256(traffic_key, seq_bytes)[0:12]
aad            = channel_id_bytes
plaintext      = MessagePack_encode(message)
ciphertext_tag = ChaCha20-Poly1305_encrypt(traffic_key, nonce, plaintext, aad)
sealed         = base64url_no_pad(seq_bytes || ciphertext_tag)
```

For this envelope, `aad = channel_id_bytes`. This binds every ciphertext to its channel without coupling encryption to fields inside the MessagePack payload.

The relay forwards `sealed` unchanged and never needs to decode the MessagePack value.

### Decryption

1. Base64url-decode `sealed` and split its first 4 bytes as `seq_bytes`.
2. Reject a sequence number that is not strictly greater than the last accepted sequence number.
3. Rebuild `nonce` and `aad`, then decrypt and verify with ChaCha20-Poly1305.
4. Reject an AEAD failure; otherwise MessagePack-decode the plaintext value and record the accepted sequence number.

### Sequence numbers

Each peer owns a separate unsigned 32-bit send counter, starting at `0` and increasing by one per sealed message. The receiver starts at `-1`; gaps are valid, but replays and out-of-order messages are rejected. Counters persist across reconnects and MUST NOT reset. At `2^31`, the peer closes with reason `normal` and requires fresh pairing.

## Security property

An observer may know the channel ID, both public keys, and ciphertexts, but cannot derive `shared_secret` or decrypt messages. Only the two holders of the ephemeral private keys can derive the directional keys and read or write channel messages.
