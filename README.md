# WalletPair

WalletPair connects a browser dApp to a mobile Wallet through an untrusted
WebSocket relay. Application messages are end-to-end encrypted between the
DApp and Wallet; the relay only routes channel events and opaque frames.

This repository contains the protocol specifications, Rust relay, browser
extension, documentation site/playground, and the ProVerif security model.

## Official Services

| Service | URL |
| --- | --- |
| Website, documentation, and playground | [https://walletpair.org](https://walletpair.org) |
| Production WebSocket relay | `wss://relay.walletpair.org/v1` |
| Relay health check | [https://relay.walletpair.org/healthz](https://relay.walletpair.org/healthz) |

Clients append the required `ch`, `name`, `url`, `icon`, and `pubkey` query
parameters to the production relay URL. Use `wss://` for all public clients.

## System Overview

```text
                         walletpair: QR URI
┌──────────────┐       ─────────────────────▶       ┌──────────────┐
│ Browser dApp │                                      │ Mobile Wallet│
└──────┬───────┘                                      └──────┬───────┘
       │ EIP-1193                                            │
       ▼                                                     │
┌────────────────────┐      encrypted MessagePack            │
│ WalletPair Extension│ ◀────────────────────────────────────▶│
└─────────┬──────────┘      ChaCha20-Poly1305                 │
          │                                                   │
          └──────────────┐                     ┌──────────────┘
                         ▼                     ▼
                    ┌────────────────────────────┐
                    │ WalletPair WebSocket Relay │
                    └────────────────────────────┘
```

The extension is the DApp-side protocol peer. It injects an EIP-1193 provider,
creates the channel and QR pairing URI, pins the first eligible Wallet joiner,
and owns the persisted encrypted session. It implements the WalletPair
protocols directly and does not depend on `walletpair-sdk`.

## Repository Layout

| Path | Purpose |
| --- | --- |
| [`protocols/`](./protocols/) | Normative relay, encryption, and Ethereum protocol definitions |
| [`walletpair-relay/`](./walletpair-relay/) | Minimal Rust/Axum channel relay |
| [`walletpair-extension/`](./walletpair-extension/) | Chrome/Firefox EIP-1193 browser extension |
| [`walletpair.org/`](./walletpair.org/) | SvelteKit documentation site and protocol playground |
| [`formal-verification/`](./formal-verification/) | ProVerif model and proof scope |
| [`brands/`](./brands/) | WalletPair brand assets |

Each application is an independent project; there is no root-level package or
single monorepo build command.

## Protocols

### Relay

A WebSocket connection to `/v1` must provide all five participant fields:

```text
?ch=<channel-id>&name=<name>&url=<url>&icon=<icon-url>&pubkey=<x25519-public-key>
```

Joining automatically subscribes the connection to `ch`. The relay broadcasts
a `channel_joined` event to the whole channel and forwards later text/binary
frames to every other active connection in that channel. A sender does not
receive its own application frame.

See [Relay Protocol](./protocols/relay.md).

### Pairing and Encryption

- The DApp and Wallet generate fresh X25519 key pairs per channel.
- The Wallet obtains the DApp identity and public key from a `walletpair:` QR
  URI and compares a four-digit code with the DApp page.
- X25519 and HKDF-SHA256 derive independent DApp→Wallet and Wallet→DApp keys.
- JSON values are encoded using the protocol's restricted MessagePack profile.
- ChaCha20-Poly1305 authenticates the channel, transcript, direction, sequence,
  and public CAIP-2 chain suffix.
- Directional sequence numbers are persisted across reconnects and never reset
  while traffic keys are reused.

See [Encryption Protocol](./protocols/encryption.md).

### Ethereum

Ethereum messages use compact request, response, and event objects inside the
encrypted payload. The public authenticated frame suffix selects the chain:

```text
<sealed>@eip155:1
```

The protocol defines EIP-1193 provider behavior, account and permission
methods, signing, transactions, EIP-5792 calls, events, validation, and an
explicit allowlist of read-only RPC methods.

See [Ethereum Protocol](./protocols/ethereum.md).

## Quick Start

### 1. Run the local relay

Requirements: a current Rust toolchain.

```bash
cd walletpair-relay
cargo run
```

The relay listens at `ws://127.0.0.1:3000/v1` by default.

### 2. Run the browser extension

Requirements: Node.js, pnpm, and Chrome/Chromium or Firefox.

```bash
cd walletpair-extension
pnpm install
pnpm dev
```

Set the relay URL in the extension settings to
`ws://127.0.0.1:3000/v1` for local development. The default production relay is
`wss://relay.walletpair.org/v1`. For production builds and unpacked-extension
instructions, see the
[Extension README](./walletpair-extension/README.md).

### 3. Run the documentation site and playground

```bash
cd walletpair.org
pnpm install
pnpm dev
```

Vite prints the local site URL after startup.
The deployed site is available at [https://walletpair.org](https://walletpair.org).

## Verification

Relay:

```bash
cd walletpair-relay
cargo test
```

Extension:

```bash
cd walletpair-extension
pnpm check
pnpm test
pnpm build
pnpm build:firefox
```

Documentation site/playground:

```bash
cd walletpair.org
pnpm check
pnpm test:unit -- --run
pnpm build
```

Formal model with ProVerif 2.05:

```bash
opam exec -- proverif formal-verification/encryption.pv
```

The formal model covers DApp authentication to the Wallet, accepted-message
correspondence, and Wallet message secrecy under the documented idealizations.
Read [the model notes](./formal-verification/README.md) for assumptions and
properties that remain implementation-tested rather than symbolically proven.

## Security Scope

- The relay is untrusted and can observe metadata or cause denial of service.
- The four-digit comparison is a short human authentication check with the
  limitations documented in the encryption protocol.
- The Wallet authenticates the DApp; the DApp intentionally accepts the first
  eligible Wallet joiner and does not authenticate Wallet identity.
- Reconnection requires local persistence of the DApp's ephemeral channel
  private key and sequence counters. The extension erases them on explicit
  disconnect or session expiry.

Security-sensitive behavior should be changed in the normative protocol first,
then updated in every implementation and the formal model where applicable.

## License

[MIT](./LICENSE) © WalletPair.
