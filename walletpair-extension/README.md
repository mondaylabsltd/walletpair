# WalletPair browser extension

The DApp side of [WalletPair](../spec/README.md) for every site in the browser: EVM, TRON and Solana dApps use the wallet on your phone, unchanged, over an end-to-end encrypted [PeerConnect](./vendor/peerconnect/README.md) link. Chrome (MV3) and Firefox 128+ (MV2).

| Network | What pages see | Specification |
|---|---|---|
| EVM | EIP-1193 provider, announced with EIP-6963; `window.ethereum` when no other wallet took it | [evm.md](../spec/networks/evm.md) §3 |
| TRON | TIP-1193 provider announced with TIP-6963, a `tronWeb` signing object; `window.tron`, `window.tronLink`, `window.tronWeb` when no other wallet took them. | [tron.md](../spec/networks/tron.md) §3 |
| Solana | A Wallet Standard wallet | [solana.md](../spec/networks/solana.md) §3 |

## Architecture

```text
page (MAIN world)  lib/inpage/   evm.ts · tron.ts · solana.ts
                                       │ bridge.ts: window messages
content script     entrypoints/content.ts
                                       │ runtime port (the browser supplies the page's origin)
background         entrypoints/background.ts
                     lib/background/router.ts    per-site approval, local answers,
                                                 EVM node reads, forwarding, cancellation
                     lib/background/session.ts   one PeerConnect room with the Wallet
                     lib/walletpair/             protocol messages, client, network checks
                                       │ vendor/peerconnect (WebAssembly)
                             PeerConnect relay ── phone Wallet
```

`lib/walletpair/` is the shared protocol code: message parsing and field rules (`protocol.ts`), the DApp-side client (`client.ts`), a Wallet's receive steps (`dispatch.ts`), and one module per network with its chains, accounts and input checks (`networks/`).

## Session lifecycle

- **Pairing.** The first site that asks for accounts, or *Pair Wallet* in the side panel, creates a PeerConnect room and shows `walletpair:<invite>` as a QR code. `walletpair_connect` for all three networks is queued at once, carrying the requesting site's origin, so the phone shows its prompt as soon as it has scanned.
- **Sites.** A site sees a network's accounts only after it is granted that network. Everything the user approved on the phone is granted to the site the phone's prompt named; any other site waits for *Allow* in the side panel. Grants are cleared when the session ends.
- **Calls.** Each Wallet function is checked locally first (the Wallet checks again), then sent with the site's `origin`. There are no timeouts: a call waits while the phone is offline, and is cancelled (`walletpair_cancel`) when its page closes or navigates.
- **Restarts.** The room record is stored, and every start of the background (the browser stopping the MV3 service worker, a browser restart) restores it, cancels calls left pending, and asks the Wallet for its current state again.
- **Ending.** *Disconnect wallet* closes the room. The Wallet is told the next time it is reachable; the extension keeps trying for up to seven days.

## Storage (`chrome.storage.local`)

| Key | Contents |
|---|---|
| `room` | The PeerConnect room record: a secret (it holds the room's keys) |
| `closingRooms` | Records of rooms being closed, until the Wallet acknowledges |
| `session` | The Wallet's name and the session state, so pages get answers while reconnecting |
| `pendingIds` | Ids of calls waiting for the Wallet, cancelled after a restart |
| `sites` | Origin → granted networks |
| `settings` | Relay URL for new pairings, EVM RPC endpoints |
| `activityLog` | The last 50 calls |

## Settings

The relay for new pairings is a PeerConnect relay URL (`ws://` or `wss://`), by default `wss://relay.peerconnect.dev`. A paired session stays on the relay it was created on.

## Development

```sh
pnpm install
pnpm dev                 # Chrome, with reload
pnpm dev:firefox
pnpm build               # .output/chrome-mv3
pnpm build:firefox       # .output/firefox-mv2
pnpm check               # svelte-check and TypeScript
```

## Trying it by hand with the CLI wallet

`pnpm wallet` is a WalletPair Wallet in the terminal, for EVM, TRON and Solana, standing in for a phone:

1. `pnpm build`, then load `.output/chrome-mv3` as an unpacked extension.
2. Open any dApp and connect; the side panel shows the pairing QR code. Click *Copy link*.
3. `pnpm wallet "walletpair:…"`: the wallet pairs, prints its accounts, and shows each request decoded (message text, typed data, transaction fields, the TRON contract and its owner, Solana transactions). Answer `y` or `n`.
4. While it runs: `chain eip155:137` (or `tron:728126428`, `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, …) switches a chain, `revoke` withdraws the approval, `leave` goes offline for 5 s, `end` ends the session, `quit` exits. `pnpm wallet --resume` continues after a restart.

Test keys only: they are generated and kept in plain text in `.walletpair-wallet.json`. Transactions are signed, never broadcast.

## Tests

| Command | What runs |
|---|---|
| `pnpm test` | Unit, property and conformance tests (vitest): the spec's test vectors, the client against the reference Wallet (`test/wallet/`) in memory, the page providers, fast-check properties of every parser and check |
| `PEERCONNECT_RELAY_BIN=… pnpm test:integration` | The extension's session and router against the reference Wallet over the real PeerConnect client and a real relay |
| `PEERCONNECT_RELAY_BIN=… pnpm test:e2e` | Chrome with the built extension; a test dApp using viem, TronWeb's wallet adapter and Solana's wallet adapter; the reference Wallet as the phone |
| `PEERCONNECT_RELAY_BIN=… pnpm test:e2e:firefox` | The same core flows in the installed Firefox |
| `PEERCONNECT_RELAY_BIN=… pnpm test:e2e:demo` | The website's `/demo` (built site in workerd) with the extension in Chrome: pairing, approving and verifying on all three networks by clicking the page |
| `PEERCONNECT_RELAY_BIN=… pnpm test:e2e:cli` | Chrome and the test dApp with the CLI wallet as a separate process, its prompts answered on its stdin, on all three networks |
| `PEERCONNECT_RELAY_BIN=… pnpm bench` | Latency and throughput of WalletPair over PeerConnect on loopback |
| `npx tsx test/vectors/generate.ts` | Regenerates `spec/test-vectors/{evm,tron,solana}.json` with viem, TronWeb and web3.js |

`PEERCONNECT_RELAY_BIN` is a `peerconnect-relay` binary (`cargo build --release -p peerconnect-relay` in PeerConnect); `PEERCONNECT_RELAY=ws://…` uses a running relay instead. Without either, the relay tests are skipped.

## License

[MIT](../LICENSE)
