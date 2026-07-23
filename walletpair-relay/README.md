# WalletPair Relay

An intentionally minimal WebSocket relay for WalletPair channels.

## Run from source

```sh
cargo run
```

The relay listens on `0.0.0.0:3000` by default. Override it with:

```sh
WALLETPAIR_RELAY_LISTEN_ADDR=127.0.0.1:4000 cargo run
```

Health check: `GET /healthz` returns `200 OK` while the process can serve HTTP.

## Telegram alerts

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to receive alerts for relay
startup/runtime failures, panics, and messages dropped because a client fell
behind. The Compose configuration passes these values from its `.env` file (or
the shell environment) into the container.

Each alert category is sent at most once. Compose persists the sent-alert state
in its `relay-state` Docker volume, so a restart loop will not flood the chat.
For direct source runs, set `TELEGRAM_ALERT_STATE_FILE` to a writable persistent
file to retain this protection across restarts. Failed Telegram sends are logged
locally and are not retried, which also avoids duplicate messages.

## Docker

Build and run directly:

```sh
docker build -t walletpair-relay:local .
docker run --rm -p 3000:3000 walletpair-relay:local
```

Or use Compose:

```sh
docker compose up --build -d
docker compose ps
docker compose down
```

Set `WALLETPAIR_RELAY_PORT` to change the published host port or
`WALLETPAIR_RELAY_IMAGE` to run a prebuilt image:

```sh
WALLETPAIR_RELAY_PORT=4000 docker compose up --build -d
```

The runtime container uses an unprivileged user, a read-only filesystem, and a
Docker health check.

Tags matching `relay-v<version>` publish Linux, macOS, and Windows binaries for
x86_64 and arm64 to the GitHub release, plus a multi-platform image to
`<dockerhub-username>/walletpair-relay:<version>`. Configure the repository
variable `DOCKERHUB_USERNAME` and Actions secret `DOCKERHUB_TOKEN` before the
first release.

## WebSocket protocol

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
