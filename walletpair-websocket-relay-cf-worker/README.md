# WalletPair WebSocket Relay — Cloudflare Worker

Cloudflare Workers + Durable Objects implementation of the WalletPair WebSocket relay protocol.

## Architecture

- **Worker (`src/index.ts`)**: Routes HTTP requests. Extracts the channel ID from `?ch=<64-hex-chars>` and forwards WebSocket upgrades to the appropriate `ChannelDO`.
- **ChannelDO (`src/channel.ts`)**: One Durable Object per channel. Both peers (dApp + wallet) connect their WebSockets here. Manages the full protocol state machine with hibernation support.
- **Protocol (`src/protocol.ts`)**: Message parsing, validation, and builder functions. Exact parity with the Rust relay.

## WebSocket Endpoint

```
wss://<your-worker>.workers.dev/v1?ch=<64-hex-lowercase-channel-id>
```

Subprotocol: `walletpair.v1` (optional, negotiated if offered by client).

## Development

```bash
npm install
npm run dev       # local dev server via wrangler
npm run typecheck # type checking
npm test          # run tests
```

## Deployment

```bash
npx wrangler deploy
```

## Differences from the Rust Relay

| Aspect | Rust relay | CF Worker relay |
|---|---|---|
| Channel routing | First message binds channel | `?ch=` query param required on connect |
| Global channel limit | Configurable cap | N/A (DO horizontal scaling) |
| Per-IP rate limiting | In-process token bucket | Deferred to CF WAF / rate limiting rules |
| Expiry | Background cleanup task | DO alarm API |
| Persistence | In-memory + optional state file | DO storage (survives hibernation) |
