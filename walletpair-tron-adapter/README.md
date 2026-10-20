# @walletpair/tronwallet-adapter

A [`@tronweb3/tronwallet-adapter`](https://github.com/tronweb3/tronwallet-adapter) adapter for [WalletPair](https://walletpair.org): TRON dApps list **WalletPair** in their wallet menu, and users sign with the wallet on their phone through the WalletPair browser extension.

```ts
import { WalletProvider } from '@tronweb3/tronwallet-adapter-react-hooks';
import { TronLinkAdapter } from '@tronweb3/tronwallet-adapter-tronlink';
import { WalletPairAdapter } from '@walletpair/tronwallet-adapter';

const adapters = [new TronLinkAdapter(), new WalletPairAdapter()];

<WalletProvider adapters={adapters}>{/* … */}</WalletProvider>;
```

Or on its own:

```ts
const adapter = new WalletPairAdapter();
await adapter.connect();                       // the user approves on the phone
const signed = await adapter.signTransaction(transaction);
const signature = await adapter.signMessage('hello');
```

## Behaviour

| | |
|---|---|
| Name, icon | `WalletPair`, the WalletPair logo |
| Detection | The extension's TIP-6963 announcement (`rdns` `org.walletpair.extension`), or `window.walletpair.tron` |
| `connect()` | `eth_requestAccounts`; a site the user already approved is connected on load |
| `signTransaction`, `signMessage` | Signed on the phone (spec: `tron_signTransaction`, `tron_signMessage` V2) |
| `multiSign` | The transaction must already carry its `Permission_id` |
| `switchChain(chainId)` | Mainnet `0x2b6653dc`, Shasta `0x94a9059e`, Nile `0xcd8690dc` |
| `network()` | From the wallet's chain ID; no node is queried |
| `disconnect()` | The site stops seeing the account; the WalletPair session stays |
| `signTypedData` | Not supported (the protocol leaves out TIP-712) |

Without the adapter, a dApp that lists only `TronLinkAdapter` still reaches WalletPair through the `window.tronLink` the extension installs when TronLink is absent, but shows it as "TronLink".

## Development

```sh
pnpm install
pnpm check && pnpm test && pnpm build
```

The extension's end-to-end test (`walletpair-extension/e2e/`) uses this adapter in Chrome and Firefox against the real extension.

## License

MIT
