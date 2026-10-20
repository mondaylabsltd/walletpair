# WalletPair Protocol

WalletPair lets a DApp use a Wallet on another device. It is a short list of functions, each with a name, an input and an output, that a DApp calls on a Wallet, and one event the Wallet sends back.

```text
┌──────────────┐   functions and events (JSON)    ┌──────────────┐
│     DApp     │ ◀──────────────────────────────▶ │    Wallet    │
├──────────────┤                                  ├──────────────┤
│ PeerConnect  │ ◀── pairing, end-to-end ───────▶ │ PeerConnect  │
└──────┬───────┘     encryption, reliable         └──────┬───────┘
       │             delivery                            │
       └────────────▶  PeerConnect relay  ◀──────────────┘
```

**PeerConnect** (protocol version 1) carries every message. It pairs the two devices from a QR code, encrypts end to end with a Noise handshake, and delivers messages once and in order, holding them while the other side is offline. Its relays store nothing and cannot read what they forward. WalletPair defines only the messages, and runs no servers of its own.

## Documents

| Document | Contents |
|---|---|
| [Core](./core.md) | What every network shares: pairing URI, message format, `walletpair_connect`, session state and the `state` event, `walletpair_cancel`, repeated requests, errors, security, evolution. |

### Networks

Each network specification adds one CAIP-2 namespace: its chains and accounts, its functions, and how a DApp side exposes them to web applications.

| Namespace | Specification | DApp-facing interface |
|---|---|---|
| `eip155` | [EVM](./networks/evm.md) | EIP-1193 provider, EIP-6963 discovery |
| `tron` | [TRON](./networks/tron.md) | TIP-1193 provider, TIP-6963 discovery, TronLink compatibility |
| `solana` | [Solana](./networks/solana.md) | Wallet Standard |

A new network is a new document in `networks/`; the core does not change.

## Conformance

[`test-vectors/`](./test-vectors/) holds the cases every implementation must reproduce: how a receiver classifies messages, which inputs each function accepts, and, for Wallets, the exact bytes each network signs.

## Example

```text
DApp shows QR    walletpair:wss://relay.example.com#q3V0…          Wallet scans it

DApp → Wallet    {"id":"1","method":"walletpair_connect","params":[{"name":"Example DApp","namespaces":["eip155"]}]}
Wallet → DApp    {"id":"1","result":{"wallet":{"name":"Example Wallet"},
                  "state":{"eip155":{"chain":"eip155:1","accounts":["0xd8da6bf26964af9d7eed9e03e53415d37aa96045"]}}}}

DApp → Wallet    {"id":"2","method":"personal_sign","params":["0x68656c6c6f","0xd8da6bf26964af9d7eed9e03e53415d37aa96045"]}
Wallet → DApp    {"id":"2","result":"0x5d5f…1b"}

Wallet → DApp    {"event":"state","data":{"eip155":{"chain":"eip155:137","accounts":["0xd8da6bf26964af9d7eed9e03e53415d37aa96045"]}}}
```
