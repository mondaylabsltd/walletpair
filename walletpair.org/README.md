# WalletPair Website

The WalletPair website and documentation: [walletpair.org](https://walletpair.org). The Protocol pages are rendered at build time from the repository's [`spec/`](../spec/), so the site always shows the specification as committed.

## Development

Requirements: Node.js and pnpm.

```sh
pnpm install
pnpm dev
```

Vite prints the local development URL after startup.

## Verification

```sh
pnpm check
pnpm build
```

To serve the built Worker in the Cloudflare runtime locally: `npx wrangler dev --port 8787`.

The production build uses SvelteKit with the Cloudflare adapter. `pnpm build`
generates the Cloudflare Worker output and then verifies the committed Wrangler
environment types.

## Deployment

```sh
pnpm deploy
```

Deployment requires an authenticated Wrangler session with access to the
Cloudflare account hosting `walletpair.org`.
