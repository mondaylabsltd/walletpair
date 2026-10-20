# WalletPair

WalletPair lets a DApp use a Wallet on another device. It is a short list of functions, each with a name, an input and an output, that a DApp calls on a Wallet.

The messages travel over [PeerConnect](#transport), which provides the relay, pairing, end-to-end encryption and reliable delivery. WalletPair runs no servers of its own.

This version supports EVM chains only.

```text
DApp shows QR    walletpair:wss://relay.example.com#q3V0…          Wallet scans it

DApp → Wallet    {"id":"1","method":"walletpair_connect","params":[{"name":"Example DApp"}]}
Wallet → DApp    {"id":"1","result":{"wallet":{"name":"Example Wallet"},
                  "eip155":{"accounts":["0xd8da…6045"],"chainId":"0x1"}}}

DApp → Wallet    {"id":"2","method":"personal_sign","params":["0x68656c6c6f","0xd8da…6045"]}
Wallet → DApp    {"id":"2","result":"0x5d5f…1b"}

Wallet → DApp    {"event":"chainChanged","data":"0x89"}
```

The full protocol is in **[SPEC.md](./SPEC.md)**.

## Repository

| Path | |
| --- | --- |
| [`SPEC.md`](./SPEC.md) | The protocol |
| [`walletpair-extension/`](./walletpair-extension/) | Browser extension: an EIP-1193 provider for any website, paired with a mobile Wallet |
| [`walletpair.org/`](./walletpair.org/) | Website: [walletpair.org](https://walletpair.org) |
| [`brands/`](./brands/) | Logos |

## Transport

PeerConnect connects two peers through a relay that cannot read, forge or replay their messages, and that stores nothing. WalletPair uses relays that PeerConnect deploys; the DApp picks one, and the QR code carries it to the Wallet.

## License

[MIT](./LICENSE) © WalletPair.
