# WalletPair Website

The WalletPair documentation site and interactive protocol playground.

- Production website: [https://walletpair.org](https://walletpair.org)
- Production WebSocket relay: `wss://relay.walletpair.org/v1`
- Relay health check: [https://relay.walletpair.org/healthz](https://relay.walletpair.org/healthz)

## Development

Requirements: Node.js and pnpm.

```sh
pnpm install
pnpm dev
```

Vite prints the local development URL after startup. The playground defaults
to the production relay; change it to a local `ws://` endpoint when developing
the relay locally.

## Verification

```sh
pnpm check
pnpm test:unit -- --run
pnpm build
```

The production build uses SvelteKit with the Cloudflare adapter. `pnpm build`
generates the Cloudflare Worker output and then verifies the committed Wrangler
environment types.

## Deployment

```sh
pnpm deploy
```

Deployment requires an authenticated Wrangler session with access to the
Cloudflare account hosting `walletpair.org`.
