# WalletPair Browser Extension

WalletPair is a Chrome and Firefox EIP-1193 provider that connects browser
dApps to a mobile Wallet over an end-to-end encrypted WebSocket channel.

The extension implements the WalletPair protocols directly and does not depend
on `walletpair-sdk`. The protocol specifications are the source of truth:

- [Relay protocol](../protocols/relay.md)
- [Encryption protocol](../protocols/encryption.md)
- [Ethereum protocol](../protocols/ethereum.md)

Official services:

- Website and documentation: [https://walletpair.org](https://walletpair.org)
- Default production relay: `wss://relay.walletpair.org/v1`

## Features

- EIP-1193 provider exposed as `window.walletpair` and, when available,
  `window.ethereum`
- EIP-6963 provider discovery
- QR pairing with a four-digit DApp verification code
- Per-channel ephemeral X25519 keys and HKDF-SHA256 directional keys
- JSON-only MessagePack payloads encrypted with ChaCha20-Poly1305
- CAIP-2 authenticated chain context and persistent replay counters
- Automatic WebSocket and MV3 service-worker recovery
- Per-origin account permissions
- Expandable request activity for pending, successful, rejected, and failed
  requests
- Chrome side panel and Firefox-compatible builds

## Architecture

```text
dApp
  │ EIP-1193 / EIP-6963
  ▼
provider.content.ts (MAIN world)
  │ window.postMessage
  ▼
content.ts (ISOLATED world)
  │ chrome.runtime.Port
  ▼
background.ts (session owner)
  │ X25519 + HKDF + MessagePack + ChaCha20-Poly1305
  ▼
WalletPair relay ───────── encrypted frames ───────── Mobile Wallet
```

The relay can see channel metadata, public keys, CAIP-2 suffixes, timing, and
ciphertext sizes. It cannot derive the shared secret or read application
payloads.

## Pairing and Session Lifecycle

1. The extension creates a channel and ephemeral X25519 key pair.
2. It connects to the relay with the required `ch`, `name`, `url`, `icon`, and
   `pubkey` query fields.
3. The Wallet scans the `walletpair:` URI and independently computes the
   four-digit DApp verification code.
4. The extension pins the first eligible Wallet `channel_joined` event. Later
   participants and frames that do not authenticate with that Wallet's key are
   ignored.
5. Ethereum request and response objects are encoded as MessagePack, encrypted,
   and transported as `<sealed>@<caip-2>` frames.

### Persisted reconnect state

The background service worker stores the minimum state needed to recover the
same encrypted channel in `chrome.storage.local`:

| Data | Stored values |
| --- | --- |
| DApp channel | Relay URL, channel ID, `name`, `url`, `icon`, public key, and ephemeral private key |
| Pinned Wallet | `name`, `url`, `icon`, and X25519 public key |
| Encryption state | Independent send and receive sequence numbers |
| Connected account | Address, active chain, protocol, and Wallet display metadata |
| Lifetime | Timestamp used by the 24-hour session limit |

The private key and counters must be persisted together: reusing a traffic key
after resetting its sequence would risk nonce reuse. If counter persistence or
snapshot validation fails, the extension abandons the channel and requires a
fresh pairing.

### Automatic reconnect

- An unexpected WebSocket close retains the snapshot and starts bounded
  exponential backoff from 1 second to 30 seconds.
- A protocol-valid encrypted keepalive runs while connected.
- A persistent browser alarm restores the session if the MV3 service worker was
  suspended and later restarted.
- Reconnect reuses the saved channel, DApp key pair, pinned Wallet identity, and
  directional counters. It does not accept a different Wallet.

### Explicit disconnect

When the user selects **Disconnect**, the extension:

1. Cancels scheduled and in-flight reconnect attempts.
2. Closes the socket and erases in-memory channel and traffic keys.
3. Waits for queued counter writes to finish.
4. Atomically removes `sessionState`, `connectedWallet`, and `connectedAt` before
   reporting success.

Relay settings and per-origin permissions are retained because they are user
configuration, not credentials for the closed channel.

## Ethereum Behavior

Handled locally:

```text
eth_chainId
net_version
eth_accounts
wallet_getPermissions
```

Forwarded over the encrypted channel:

```text
eth_requestAccounts
wallet_switchEthereumChain
wallet_addEthereumChain
wallet_requestPermissions
eth_sendTransaction
personal_sign
eth_signTypedData
eth_signTypedData_v1
eth_signTypedData_v3
eth_signTypedData_v4
wallet_sendCalls
wallet_getCallsStatus
wallet_getCapabilities
```

Explicitly allowlisted read-only Ethereum RPC methods are sent to the configured
RPC endpoint. Unknown methods are rejected instead of being forwarded
speculatively. See [the Ethereum protocol](../protocols/ethereum.md) for the
wire objects, validation rules, supported read methods, and events.

## Development

Requirements: Node.js, pnpm, and a Chromium- or Firefox-based browser.

```bash
pnpm install
pnpm dev              # Chrome development mode
pnpm dev:firefox      # Firefox development mode
pnpm check            # TypeScript and Svelte diagnostics
pnpm test             # Unit and protocol interoperability tests
pnpm test:e2e         # Browser provider integration tests
```

Production builds:

```bash
pnpm build            # .output/chrome-mv3/
pnpm build:firefox    # .output/firefox-mv2/
pnpm zip
pnpm zip:firefox
```

### Load the Chrome build

1. Run `pnpm build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose `.output/chrome-mv3/`.

Reload the unpacked extension after rebuilding when testing background or UI
changes.

## Source Layout

```text
src/
├── entrypoints/
│   ├── provider.content.ts   # EIP-1193 provider in the page world
│   ├── content.ts            # Isolated bridge
│   ├── background.ts         # Session, permissions, RPC routing, reconnect
│   ├── popup/                # Popup UI and shared visual theme
│   └── sidepanel/            # Side-panel entrypoint
├── components/               # Pairing, connected state, activity, settings
└── lib/
    ├── walletpair/           # Relay, crypto, MessagePack, Ethereum, session
    ├── protocols/ethereum/   # Supported method sets and helpers
    ├── storage.ts            # Ordered persistent state operations
    └── provider-factory.ts   # EIP-1193/EIP-6963 provider implementation
```

## Security Notes

- The four-digit comparison authenticates the scanned DApp fields to the Wallet
  under the assumptions documented in the encryption protocol. It is a short
  human check, not cryptographic-strength authentication.
- The DApp intentionally trusts the first eligible Wallet participant; the
  protocol does not authenticate Wallet identity to the DApp.
- The relay can drop, delay, replay, reorder, or inject frames. AEAD and sequence
  checks detect forgery and replay but cannot prevent denial of service.
- Reconnection requires storing the channel's ephemeral private key in extension
  local storage. It is removed on explicit disconnect or session expiry but is
  not protected by hardware-backed key storage.

The encryption design also has a [ProVerif model](../formal-verification/README.md)
covering DApp authentication to the Wallet, accepted-message correspondence,
and Wallet message secrecy under the documented idealizations.
