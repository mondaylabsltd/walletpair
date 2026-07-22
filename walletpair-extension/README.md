# WalletPair Browser Extension

A Chrome/Firefox browser extension that bridges any dApp to your mobile wallet via the [WalletPair protocol](../walletpair-protocol-v1.md). Acts as an EIP-1193 injected provider that routes signing requests through a relay to your wallet app.

## How It Works

```
┌─────────┐     window.ethereum      ┌────────────┐     chrome.runtime      ┌────────────┐
│  dApp    │ ──── request() ────────> │  Provider   │ ────── port ─────────> │ Background │
│  (page)  │ <─── response/events ─── │  (MAIN)     │ <───── port ────────── │  (SW)      │
└─────────┘                           └────────────┘                         └────────────┘
                                                                                    │
                                                                          WalletPair SDK
                                                                          (DAppSession)
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

3. **Background Service Worker** (`background.ts`) — Manages the WalletPair SDK session, routes requests to the wallet via relay, handles permissions and confirmations.

## Supported Standards

| Standard | Status | Notes |
|----------|--------|-------|
| EIP-1193 | Full | `request()`, events, error codes |
| EIP-6963 | Full | Multi-wallet discovery (`eip6963:announceProvider`) |
| EIP-1102 | Full | `eth_requestAccounts` authorization flow |
| EIP-3085 | Not Supported | `wallet_addEthereumChain` — WalletPair proxies to the mobile wallet; chain management is the wallet's responsibility |
| EIP-3326 | Full | `wallet_switchEthereumChain` |
| personal_sign | Full | Hex and text messages |
| eth_signTypedData_v4 | Full | EIP-712 structured data |
| eth_sendTransaction | Full | Forwarded to wallet for confirmation |
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

- Session state persisted to `chrome.storage.local`
- Restored on service worker restart
- Keepalive alarm (every 20s) sends ping to maintain relay connection
- Automatic reconnect with exponential backoff + jitter

### Sidepanel

The sidepanel reuses the popup's `App.svelte` component with its own container sizing, providing the same UI in either popup or sidepanel mode.

## Security

- End-to-end encryption (ChaCha20-Poly1305) between extension and wallet
- Directional session keys prevent cross-direction forgery
- All messages require authenticated encryption (no plaintext messages accepted)
- Pairing code verification prevents MITM attacks
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
npm run test       # 236 unit tests
npm run test:e2e   # Full-stack E2E tests (extension + SDK + relay)
```
