# WalletPair Relay

An intentionally minimal WebSocket relay for local WalletPair development.

```sh
cargo run
```

Each WebSocket connection must identify its channel and participant. All query values must be percent-encoded:

```text
ws://127.0.0.1:3000/v1?ch=0140446dc1742a90025fcd068df3a7338314e1da1649d520798c8581a0937d0c&name=Example%20Wallet&url=https%3A%2F%2Fexample.test&icon=https%3A%2F%2Fexample.test%2Ficon.png&pubkey=HJ_Yj0VgbZMqgMcYJK4VHRXXPnfeOOjgAIUuYU-ucBk
```

| Parameter | Validation |
| --- | --- |
| `ch` | Exactly 64 lowercase hexadecimal characters. |
| `name` | Non-empty, at most 128 UTF-8 bytes, and no control characters. |
| `url` | Absolute `http:` or `https:` URL, at most 2048 UTF-8 bytes. |
| `icon` | Absolute `https:` URL, at most 2048 UTF-8 bytes. |
| `pubkey` | Canonical unpadded base64url X25519 public key: exactly 32 decoded bytes and not all zero. |

Text and binary frames are broadcast to every other active connection on the same channel. The sender does not receive its own frame, and connections on other channels receive nothing. A channel is removed automatically when its last client disconnects.

When a connection joins, every client in that channel receives this text frame:

```json
{
  "type": "channel_joined",
  "ch": "<channel-id>",
  "name": "<participant-name>",
  "url": "<participant-url>",
  "icon": "<participant-icon-url>",
  "pubkey": "<participant-x25519-public-key>"
}
```
