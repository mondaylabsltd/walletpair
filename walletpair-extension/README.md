# WalletPair Browser Extension

A Chrome/Firefox browser extension that bridges any dApp to a mobile wallet via the [WalletPair protocols](../protocols/). It is an EIP-1193 injected provider with a self-contained relay, encryption, and Ethereum implementation.

## How It Works

```
┌─────────┐     window.ethereum      ┌────────────┐     chrome.runtime      ┌────────────┐
│  dApp    │ ──── request() ────────> │  Provider   │ ────── port ─────────> │ Background │
│  (page)  │ <─── response/events ─── │  (MAIN)     │ <───── port ────────── │  (SW)      │
└─────────┘                           └────────────┘                         └────────────┘
                                                                                    │
                                                                    X25519 + MessagePack
                                                                  + ChaCha20-Poly1305
                                                                                    │
                                                                              WebSocket
                                                                                    │
                                                                              ┌─────────┐
                                                                              │  Relay  │
                                                                              └────┬────┘
                                                                                   │
                                                                              WebSocket
                                                                                    │
                                                                            ┌───────────┐
                                                                            │  Wallet   │
                                                                            │  (mobile) │
                                                                            └───────────┘
```

**Three layers in the extension:**

1. **Provider** (`provider.content.ts`, MAIN world) — Injected into every page as `window.ethereum`. Implements EIP-1193 + EIP-6963. Communicates with content script via `window.postMessage`.

2. **Content Bridge** (`content.ts`, ISOLATED world) — Bridges between page and background via `chrome.runtime.Port` with `sendMessage` fallback.

3. **Background Service Worker** (`background.ts`) — Owns the encrypted WalletPair session, routes protocol requests and events, and enforces per-origin permissions.

## Supported Standards

| Standard | Status | Notes |
|----------|--------|-------|
| EIP-1193 | Full | `request()`, events, error codes |
| EIP-6963 | Full | Multi-wallet discovery (`eip6963:announceProvider`) |
| EIP-1102 | Full | `eth_requestAccounts` authorization flow |
| EIP-3085 | Full | `wallet_addEthereumChain` is forwarded to the mobile wallet |
| EIP-3326 | Full | `wallet_switchEthereumChain` |
| personal_sign | Full | Hex and text messages |
| eth_signTypedData / v1 / v3 / v4 | Full | Exact requested typed-data version is preserved |
| eth_sendTransaction | Full | Forwarded to wallet for confirmation |
| EIP-5792 | Full | `wallet_sendCalls`, `wallet_getCallsStatus`, capability discovery |
| Legacy (`send`, `sendAsync`, `enable`) | Full | MetaMask compatibility |

## Build

```bash
npm install
npm run build          # Chrome MV3
npm run build:firefox  # Firefox
```

Output in `.output/chrome-mv3/` or `.output/firefox-mv2/`.

## Load in Chrome

1. Build the extension
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" → select `.output/chrome-mv3/`

## Development

```bash
npm run dev            # Watch mode with hot reload
npm run test           # Run unit tests
npm run test:watch     # Watch mode
```

## Architecture

### Protocol Handler Abstraction

The extension uses a chain-agnostic `ProtocolHandler` interface (`src/lib/protocols/`). All chain-specific logic (RPC proxying, method formatting, transaction building) is encapsulated in protocol handlers registered by CAIP-2 namespace. Currently ships with an Ethereum handler; adding new chains requires only implementing the interface — no core changes needed.

### Transparent Bridge (No Double Approval)

The extension acts as a **transparent bridge** — signing requests (`personal_sign`, `eth_signTypedData_v4`, `eth_sendTransaction`) are forwarded directly to the mobile wallet for confirmation. There is no confirmation popup in the extension itself, eliminating the double-approval friction.

A signing toast notification appears in the popup to indicate that a request is pending wallet confirmation.

### Permission Model

- Per-origin permissions stored in `chrome.storage.local`
- First `eth_requestAccounts` triggers pairing flow + permission grant
- `eth_accounts` returns `[]` for unpermitted origins
- Permissions can be revoked from the extension popup

### Read-Only RPC Proxy

Methods like `eth_call`, `eth_getBalance`, `eth_blockNumber` are proxied directly to public RPC nodes (configurable per chain), avoiding unnecessary round-trips through the wallet.

### Activity Log

The popup displays a request activity log showing method names, origins, timestamps, and status (pending, success, rejected, error). Up to 20 entries are displayed from 50 stored in `chrome.storage.local`.

### Service Worker Lifecycle

- Session keys and monotonic directional counters persisted to `chrome.storage.local`
- Restored on service worker restart
- A protocol-valid encrypted `eth_chainId` request keeps an active MV3 WebSocket warm
- A persistent alarm detects service-worker/socket loss
- Automatic reconnect with bounded exponential backoff

### Sidepanel

The sidepanel reuses the popup's `App.svelte` component with its own container sizing, providing the same UI in either popup or sidepanel mode.

## Security

- Per-channel ephemeral X25519 and HKDF-SHA256 directional keys
- JSON-only MessagePack inside ChaCha20-Poly1305 authenticated encryption
- CAIP-2 chain context and monotonic sequence number bound into AEAD additional data
- Four-digit DApp fingerprint for the Wallet-side human comparison
- Content script isolation (ISOLATED + MAIN world separation)
- Per-origin permission checks
- RPC proxy has 30s timeout and 2MB response limit

## Configuration

Default relay: `wss://relay.walletpair.org/v1`

Configurable in extension settings:
- Relay URL
- Per-chain RPC endpoints

## Tests

```bash
npm run test       # Unit and protocol interoperability tests
npm run test:e2e   # Browser provider integration tests
```
