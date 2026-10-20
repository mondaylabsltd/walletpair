# WalletPair

WalletPair lets a dApp use a Wallet on another device. It is a short list of functions, each with a name, an input and an output, that a dApp calls on a Wallet, and one event the Wallet sends back. It covers **EVM chains, TRON and Solana**; each network is one document, so others can be added without changing the rest.

The messages travel over **PeerConnect**, which pairs the two devices from a QR code, encrypts end to end, and delivers messages once and in order, holding them while the other side is offline. Its relays store nothing and cannot read what they forward. WalletPair defines only the messages and runs no servers of its own.

```text
DApp shows QR    walletpair:wss://relay.example.com#q3V0…          Wallet scans it

DApp → Wallet    {"id":"1","method":"walletpair_connect","params":[{"name":"Example DApp","namespaces":["eip155","tron","solana"]}]}
Wallet → DApp    {"id":"1","result":{"wallet":{"name":"Example Wallet"},"state":{
                    "eip155":{"chain":"eip155:1","accounts":["0xd8da…6045"]},
                    "tron":{"chain":"tron:728126428","accounts":["TLa2…YjU7"]},
                    "solana":{"chain":"solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp","accounts":["7S3P…AaKv"]}}}}

DApp → Wallet    {"id":"2","method":"personal_sign","params":["0x68656c6c6f","0xd8da…6045"]}
Wallet → DApp    {"id":"2","result":"0x5d5f…1b"}

Wallet → DApp    {"event":"state","data":{"eip155":{"chain":"eip155:137",…},…}}
```

## Repository

| Path | |
| --- | --- |
| [`spec/`](./spec/) | The protocol: [core](./spec/core.md), one document per network in [`networks/`](./spec/networks/), and [test vectors](./spec/test-vectors/) |
| [`walletpair-extension/`](./walletpair-extension/) | Browser extension (Chrome, Firefox): the DApp side for every site, so existing EVM, TRON and Solana dApps work unchanged |
| [`walletpair.org/`](./walletpair.org/) | Website and documentation, [walletpair.org](https://walletpair.org) |
| [`docs/STATUS.md`](./docs/STATUS.md) | State of the project, decisions and their reasons, known limitations |
| [`brands/`](./brands/) | Logos |

## Implementing a Wallet

Join the room from the QR code with a PeerConnect client, answer the functions of the networks you support, and send the `state` event. Check your implementation against [`spec/test-vectors/`](./spec/test-vectors/): the message cases, which inputs each function accepts, and the exact signatures to expect for fixed keys.

## Development

The extension and the website form one pnpm workspace: `pnpm install` at the repository root installs both. The website's demo wallet uses the extension's protocol code and reference Wallet.

## Testing

See [the extension's README](./walletpair-extension/README.md#tests): unit, property and conformance tests run without anything else; integration and browser tests need a PeerConnect relay binary.

## License

[MIT](./LICENSE) © WalletPair.
