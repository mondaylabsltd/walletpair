# Relay Protocol

## Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be
interpreted as described in [RFC 2119](https://www.ietf.org/rfc/rfc2119.txt).

## Connection

Connect to `GET /v1` with WebSocket. The query string **must** contain exactly the five URL-encoded fields below and no others; a missing field, an invalid field, or any unexpected additional query key is rejected with `400 Bad Request` before the WebSocket upgrade.

```text
ws(s)://<relay-host>/v1?ch=<channel-id>&name=<name>&url=<url>&icon=<icon-url>&pubkey=<x25519-public-key>
```

| Field | Meaning | Validation |
| --- | --- | --- |
| `ch` | Channel ID | Exactly 64 lowercase hexadecimal characters. |
| `name` | Participant name | 1–128 UTF-8 bytes; no control characters (Unicode general category `Cc`: U+0000–U+001F and U+007F–U+009F). |
| `url` | Participant website | Absolute `http:` or `https:` URL; at most 2048 UTF-8 bytes. |
| `icon` | Participant icon | Absolute `https:` URL; at most 2048 UTF-8 bytes. |
| `pubkey` | Participant X25519 public key | Canonical unpadded base64url; exactly 32 decoded bytes; not all zero. |

Example:

```text
ws://127.0.0.1:3000/v1?ch=0140446dc1742a90025fcd068df3a7338314e1da1649d520798c8581a0937d0c&name=Example%20Wallet&url=https%3A%2F%2Fexample.test&icon=https%3A%2F%2Fexample.test%2Ficon.png&pubkey=HJ_Yj0VgbZMqgMcYJK4VHRXXPnfeOOjgAIUuYU-ucBk
```

## Join event

After a connection joins a channel, the relay sends this text frame to every active connection in that channel, including the new participant:

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

The relay MUST deliver each connection its own `channel_joined` event, and MUST send that event to the connection before delivering it any other channel event. A client MUST wait for its own `channel_joined` event before sending application frames; a peer that pins another participant MUST do so only after its own `channel_joined` has arrived.

## Message routing

- A client is automatically a member of the channel in its `ch` query parameter.
- Text and binary frames sent by a client are forwarded unchanged to every *other* active client in the same channel. WalletPair application frames are UTF-8 **text** frames (the `<sealed>@<caip-2>` string); peers send only text frames and MAY ignore any binary frame. The relay never inspects frame contents.
- The sender does not receive its own application frame.
- Clients in other channels receive nothing.
- Only active connections receive messages; the relay does not replay messages to clients that join later.
