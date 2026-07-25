# Relay Protocol

## Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be
interpreted as described in [RFC 2119](https://www.ietf.org/rfc/rfc2119.txt).

## Connection

Connect to `GET /v1` with WebSocket. The query string **must** contain exactly the five URL-encoded fields below and no others; a missing field, an invalid field, or any unexpected additional query key is rejected with `400 Bad Request` before the WebSocket upgrade. The endpoint path (`/v1` for this relay) is part of the WebSocket URL a client obtains from the pairing `relay` field; the client appends the five query parameters and MUST NOT otherwise modify the URL.

```text
ws(s)://<relay-host>/v1?ch=<channel-id>&name=<name>&url=<url>&icon=<icon-url>&pubkey=<x25519-public-key>
```

| Field | Meaning | Validation |
| --- | --- | --- |
| `ch` | Channel ID | Exactly 64 lowercase hexadecimal characters. |
| `name` | Participant name | 1–128 UTF-8 bytes; no control characters (Unicode general category `Cc`: U+0000–U+001F and U+007F–U+009F) and no format characters (category `Cf`, including the bidirectional overrides U+202A–U+202E / U+2066–U+2069 and zero-width characters), which could spoof the name shown in pairing UI. |
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

When a connection joins, the relay MUST also send to that new connection one `channel_joined` event for every participant already active in the channel (a roster of existing members), delivered after the connection's own `channel_joined`. This lets a peer that connects after another has already joined still learn it, so a channel does not deadlock when connect order and join order differ.

## Leave event

When a connection leaves a channel — because it closes the WebSocket or because the relay detects the transport is gone — the relay MUST send this text frame to every remaining active connection in that channel:

```json
{
  "type": "channel_left",
  "ch": "<channel-id>",
  "pubkey": "<departing-participant-x25519-public-key>"
}
```

A peer uses a `channel_left` for its pinned counterpart to drive session state, such as an EIP-1193 `disconnect`; it MUST ignore a `channel_left` whose `pubkey` is not its pinned counterpart. The relay SHOULD detect half-open connections with a periodic ping or idle timeout so that a silently dropped peer still produces a `channel_left`.

## Message routing

- A client is automatically a member of the channel in its `ch` query parameter.
- Text and binary frames sent by a client are forwarded unchanged to every *other* active client in the same channel. WalletPair application frames are UTF-8 **text** frames (the `<sealed>@<caip-2>` string); peers send only text frames and MAY ignore any binary frame. The relay never inspects frame contents.
- A received text frame is a relay control event (`channel_joined` or `channel_left`) if and only if it parses as the corresponding JSON object shape; otherwise it is a `<sealed>@<caip-2>` application frame. The two are unambiguous because a canonical base64url `sealed` value never begins with `{`. Control events originate from the relay; a control frame forged by a participant at most reproduces the accepted first-joiner race and cannot impersonate the DApp, since peers pin the DApp public key from the QR.
- The sender does not receive its own application frame.
- Clients in other channels receive nothing.
- Only active connections receive application frames; the relay does not replay past application frames to clients that join later (it does replay the current-member roster on join, per the Join event section).

## Limits

The relay SHOULD enforce resource bounds against abuse. These are deployment policy, not part of the wire format:

- **Frame size:** the relay SHOULD reject a text frame larger than 72 KiB. A valid sealed application frame is at most 65,556 base64url bytes plus the `@<caip-2>` suffix, so 72 KiB leaves ample margin.
- **Participants per channel, message rate, idle timeout, and channel lifetime** are deployment policy: the relay MAY cap concurrent connections per channel and MAY close idle or over-long-lived channels.
- **Close codes:** the relay SHOULD use standard WebSocket close codes — `1008` (policy violation) for a rejected or oversized frame or a capacity limit, and `1011` for an internal error.
