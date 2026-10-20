# WalletPair for TRON (`tron`)

This network specification adds TRON to [WalletPair Core](../core.md). It defines the namespace's chains and accounts, its functions, and how a DApp side exposes them to TRON web applications.

## 1. Namespace

| | |
|---|---|
| Namespace | `tron` |
| Chain | `tron:` followed by the chain ID in decimal without leading zeros (CAIP-2): the last 4 bytes of the genesis block ID, read as an unsigned 32-bit integer. |
| Account | A base58check address: 34 characters that decode to 25 bytes, the 21-byte address (`0x41` followed by 20 bytes) and its checksum, the first 4 bytes of SHA-256(SHA-256(address)). |

The TIP-1193 form of a chain ID is the same number as `0x` and 8 lowercase hexadecimal digits. Known networks:

| Network | Chain | TIP-1193 `chainId` |
|---|---|---|
| Mainnet | `tron:728126428` | `0x2b6653dc` |
| Shasta | `tron:2494104990` | `0x94a9059e` |
| Nile | `tron:3448148188` | `0xcd8690dc` |

CAIP-2 earlier wrote TRON chains in hexadecimal (`tron:0x2b6653dc`); that form is deprecated, and WalletPair uses only the decimal form.

**Encodings.** Byte strings are hexadecimal without a `0x` prefix, as in TRON's own transaction JSON (`raw_data_hex`, `txID`, `signature`). A signature is 65 bytes, `r ‖ s ‖ v`, with `v` 27 or 28 (`1b` or `1c`).

## 2. Functions

| Function | Input (`params`) | Output (`result`) |
|---|---|---|
| `tron_signTransaction` | `{ account, transaction, chain? }` | `{ signature }` |
| `tron_signMessage` | `{ account, message }` | `{ signature }` |
| `tron_switchChain` | `{ chain }` | `null` |

All three have an effect (Core §6). `account` MUST be an approved account; otherwise the Wallet answers `4100`. When `chain` is given and is not the active chain, the Wallet answers `4901`.

### 2.1 `tron_signTransaction`

`transaction` is the transaction's `raw_data_hex`: the protocol-buffer encoding of `Transaction.raw`, 1 to 65,536 bytes. The Wallet:

1. decodes it as `Transaction.raw` and answers `-32602` if it does not decode, or if it does not hold exactly one contract;
2. shows the user what the contract does, decoded from these bytes, never from a JSON rendering supplied by the DApp. When the contract's owner address is not `account`, it shows that `account` signs on another account's behalf (multi-signature);
3. SHOULD refuse, with `-32602`, a transaction whose `expiration` has passed or is more than 24 hours away;
4. signs the transaction ID, SHA-256 of the bytes, with the account's secp256k1 key, without any prefix, and returns the signature as `signature`.

The DApp side, which knows the transaction's JSON form, appends `signature` to the transaction's `signature` list. TRON transactions are tied to a network only through their reference block, so `chain` lets the DApp side say which network it built the transaction for.

### 2.2 `tron_signMessage`

`message` is the message's bytes in hexadecimal, 1 to 65,536 bytes once decoded. The Wallet signs

```text
keccak256("\x19TRON Signed Message:\n" ‖ decimal length of the message in bytes ‖ message)
```

(the "V2" message format of TronWeb's `signMessageV2`), and returns the signature as `signature`. It shows the message as text when it is valid UTF-8, and as hexadecimal otherwise.

The legacy "V1" message format, which signs any 32 bytes behind a fixed prefix and so lets a DApp obtain a signature over a hash the user cannot read, is not part of this version. Neither is TIP-712 typed data. A DApp side refuses both locally.

### 2.3 `tron_switchChain`

Makes `chain` the active chain. On success the Wallet sends the `state` event before its response (Core §4.3). A chain the Wallet does not know returns `4902`.

### Errors

Besides the core codes, `4902`: unknown chain (`tron_switchChain`).

## 3. The DApp side

TRON web applications reach wallets in two ways, and a DApp side offers both.

**TIP-1193 provider**, announced with TIP-6963 under the DApp side's own name, and installed as `window.tron` when no other wallet has done so:

| Request | Handled by |
|---|---|
| `eth_requestAccounts` (TIP-1102) | `walletpair_connect` with `tron` among its namespaces, unless `tron` is already approved; then the approved accounts |
| `wallet_switchEthereumChain` (TIP-3326) with `[{ chainId }]` | `tron_switchChain` with the corresponding chain |
| Anything else | `4200` |

Its events follow TIP-1193: `connect` with `{ chainId }`, `chainChanged` with `{ chainId }` (an object, unlike EIP-1193), `accountsChanged` with the account list (empty when `tron` leaves the state), and `disconnect` with code `4900` when the session ends. Its `tronWeb` property is `false` until the site is approved, then the signing object below.

**Signing object** (`tronWeb`), the interface TRON applications and their wallet adapters sign with:

| Member | Handled by |
|---|---|
| `defaultAddress` | `{ base58, hex }` of the first approved account; updated before `accountsChanged` is emitted |
| `ready` | Whether the site is approved |
| `trx.sign(transaction)`, `trx.signTransaction`, `trx.multiSign(transaction, _, permissionId)` | `tron_signTransaction` with the transaction's `raw_data_hex`, after checking that its `txID` is SHA-256 of it. Resolves with the transaction and the signature appended. `multiSign` requires the transaction to already carry its `Permission_id`. |
| `trx.signMessageV2(message)` | `tron_signMessage` with the UTF-8 bytes of the string. Resolves with the signature, `0x`-prefixed. |
| `trx.sign(string)`, `trx.signMessage(string)`, `trx._signTypedData`, `trx.signTypedData` | Refused (§2.2) |

A user rejection rejects these promises with the string `Confirmation declined by user`, as TRON applications expect. The signing object does not query or broadcast to nodes: applications build and broadcast transactions with their own TronWeb instance.

A DApp side MAY also install `window.tronLink` (`{ ready, request, tronWeb }`, where `request` also accepts the legacy `tron_requestAccounts` and resolves with `{ code: 200 }`, or `{ code: 4001 }` when the user declines) and `window.tronWeb` for applications written against those globals, when no other wallet has installed them.

## References

- [TIP-1193: TRON Provider JavaScript API](https://github.com/tronprotocol/tips/blob/master/tip-1193.md)
- [TIP-6963: Multi Injected Provider Discovery](https://github.com/tronprotocol/tips/blob/master/tip-6963.md)
- [TIP-1102: Opt-in account exposure](https://github.com/tronprotocol/tips/blob/master/tip-1102.md)
- [TIP-3326: Wallet switch TRON chain](https://github.com/tronprotocol/tips/blob/master/tip-3326.md)
- [TIP-104: Data signing](https://github.com/tronprotocol/tips/blob/master/tip-104.md)
- [TIP-474: Chain ID](https://github.com/tronprotocol/tips/blob/master/tip-474.md)
- [CAIP-2 for TRON](https://github.com/ChainAgnostic/namespaces/blob/main/tron/caip2.md)
- [TRON protocol buffers (`Tron.proto`)](https://github.com/tronprotocol/protocol/blob/master/core/Tron.proto)
