# WalletPair for EVM chains (`eip155`)

This network specification adds EVM chains to [WalletPair Core](../core.md). It defines the namespace's chains and accounts, its functions, and how a DApp side exposes them as an EIP-1193 provider.

## 1. Namespace

| | |
|---|---|
| Namespace | `eip155` |
| Chain | `eip155:` followed by the EIP-155 chain ID in decimal, without leading zeros (CAIP-2): `eip155:1`, `eip155:137`. Pattern: `eip155:[1-9][0-9]{0,31}`. |
| Account | `0x` followed by 40 lowercase hexadecimal digits. Addresses in function inputs may use any case (EIP-55 included) and are compared without regard to case. |

Function inputs and outputs use Ethereum's JSON-RPC encoding (EIP-1474): byte strings are `0x`-prefixed hexadecimal with two digits per byte, and quantities are `0x`-prefixed hexadecimal without leading zeros (`0x0` for zero). Where a function names a chain by its EIP-155 chain ID, it uses that quantity form: `0x1` is `eip155:1`.

## 2. Functions

| Function | Input (`params`) | Output (`result`) | Defined by |
|---|---|---|---|
| `wallet_switchEthereumChain` | `[{ chainId }]` | `null` | EIP-3326 |
| `wallet_addEthereumChain` | `[{ chainId, chainName, nativeCurrency, rpcUrls, blockExplorerUrls?, iconUrls? }]` | `null` | EIP-3085 |
| `personal_sign` | `[data, address]` | signature | EIP-191 |
| `eth_signTypedData_v4` | `[address, typedData]` | signature | EIP-712 |
| `eth_sendTransaction` | `[transaction]` | transaction hash | EIP-1474 |
| `wallet_sendCalls` | `[{ version, chainId, from?, atomicRequired, calls, id?, capabilities? }]` | `{ id, capabilities? }` | EIP-5792 |
| `wallet_getCallsStatus` | `[id]` | call bundle status | EIP-5792, read-only |
| `wallet_getCapabilities` | `[address, chainIds?]` | capabilities per chain | EIP-5792, read-only |

Inputs and outputs are as the defining standard specifies; the summaries above are not normative. A signature is 65 bytes (`r ‖ s ‖ v`) as `0x`-prefixed hexadecimal. A transaction hash is 32 bytes. In addition:

- **`personal_sign`.** `data` is the message as `0x`-prefixed hexadecimal bytes. The Wallet signs it with the EIP-191 version `0x45` prefix, and shows it as text when it is valid UTF-8.
- **`eth_signTypedData_v4`.** `typedData` is the EIP-712 payload serialized as a JSON **string**, not an object.
- **Accounts.** `address`, a transaction's `from`, and `wallet_sendCalls`'s `from` when present, MUST be approved accounts. Otherwise the Wallet answers `4100`. `eth_sendTransaction`'s transaction MUST have a `from`.
- **Active chain.** `personal_sign`, `eth_signTypedData_v4` and `eth_sendTransaction` act on the namespace's active chain. When a transaction's `chainId`, or the typed data's `domain.chainId`, names another chain, the Wallet answers `4901` and does nothing. A DApp side SHOULD set a transaction's `chainId` to the chain it believes is active, so that a request that crossed a `state` event in transit cannot act on the wrong chain. `wallet_sendCalls` names its chain explicitly and follows EIP-5792.
- **Switching.** On success, `wallet_switchEthereumChain` changes the active chain, so the Wallet sends the `state` event before its response (Core §4.3). A chain the Wallet does not know returns `4902`; this code is an ecosystem convention, not part of EIP-3326. The DApp side can then call `wallet_addEthereumChain`, which adds a chain without switching to it. Chain metadata and RPC URLs in `wallet_addEthereumChain` are untrusted input.
- **Read-only.** `wallet_getCallsStatus` and `wallet_getCapabilities` only read (Core §6). A Wallet returns call bundle status only for bundles this session sent.

Not part of this version, so a Wallet answers `4200`: `eth_sign` (signs arbitrary hashes), `eth_signTransaction`, `eth_sendRawTransaction`, the typed-data versions before v4, permission methods (EIP-2255), `wallet_showCallsStatus`, and every node method (§3).

### Errors

Besides the core codes:

| Code | Meaning |
|---:|---|
| `4902` | Unknown chain (`wallet_switchEthereumChain`). |
| `5700`–`5760` | As defined by EIP-5792. |

## 3. The DApp side: EIP-1193 provider

A DApp side exposes this namespace as an EIP-1193 provider and SHOULD announce it with EIP-6963. It handles calls as follows:

| EIP-1193 call | Handled by |
|---|---|
| `eth_requestAccounts` | `walletpair_connect` with `eip155` among its namespaces, unless `eip155` is already approved; then the approved accounts |
| `eth_accounts` | The approved accounts, or `[]`. Answered locally. |
| `eth_chainId` | The active chain's EIP-155 chain ID as a quantity (`eip155:137` → `0x89`). Answered locally. |
| `net_version` | The active chain's EIP-155 chain ID in decimal. Answered locally. |
| `wallet_revokePermissions` | Locally: the site stops seeing `eip155` accounts until it asks again; the session is unchanged. Answers `null`. |
| The functions in §2 | Forwarded to the Wallet. |
| Read-only node methods (`eth_call`, `eth_getBalance`, `eth_blockNumber`, …) | The DApp side's own RPC endpoint for the active chain. They never cross WalletPair. |
| Anything else | `4200` |

The provider:

- converts a `personal_sign` message given as plain text into its UTF-8 bytes, and a typed-data object into its JSON string, before forwarding;
- emits `connect` (with `{ chainId }`) when `eip155` becomes approved;
- on each `state` event, emits `chainChanged` when the active chain changes and `accountsChanged` when the account list changes, after updating what `eth_chainId` and `eth_accounts` return. When `eip155` leaves the state, it emits `accountsChanged` with `[]`;
- emits `disconnect` with code `4900` when the session ends, and answers every pending call with `4900`.

Node methods that the DApp side answers itself are not authenticated by the Wallet. A DApp side MUST check, before using an RPC endpoint, that the endpoint's `eth_chainId` is the active chain, and MUST NOT forward a method it has not explicitly listed as read-only.

## References

- [EIP-155: Simple replay attack protection](https://eips.ethereum.org/EIPS/eip-155)
- [EIP-191: Signed Data Standard](https://eips.ethereum.org/EIPS/eip-191)
- [EIP-712: Typed structured data hashing and signing](https://eips.ethereum.org/EIPS/eip-712)
- [EIP-1193: Ethereum Provider JavaScript API](https://eips.ethereum.org/EIPS/eip-1193)
- [EIP-1474: Remote procedure call specification](https://eips.ethereum.org/EIPS/eip-1474)
- [EIP-3085: wallet_addEthereumChain](https://eips.ethereum.org/EIPS/eip-3085)
- [EIP-3326: wallet_switchEthereumChain](https://eips.ethereum.org/EIPS/eip-3326)
- [EIP-5792: Wallet Call API](https://eips.ethereum.org/EIPS/eip-5792)
- [EIP-6963: Multi Injected Provider Discovery](https://eips.ethereum.org/EIPS/eip-6963)
- [CAIP-2: Blockchain ID Specification](https://chainagnostic.org/CAIPs/caip-2)
