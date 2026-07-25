# Ethereum Protocol

## Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be
interpreted as described in [RFC 2119](https://www.ietf.org/rfc/rfc2119.txt).

## Scope

This protocol exposes an EIP-1193 Provider for EVM chains over an encrypted
WalletPair channel. Provider behavior follows EIP-1193; Ethereum RPC parameter,
result, and hex encoding follows EIP-1474 and the specification of each method.

An EVM chain is identified by its EIP-155 chain ID. A chain ID is encoded as a
canonical `Quantity`: a lowercase `0x`-prefixed hexadecimal string with no
leading zeroes, except zero is `0x0`. Addresses and byte data are `0x`-prefixed
`Data` values with exactly two hexadecimal digits per byte.

All messages below use the JSON data model, are MessagePack-encoded, and are
encrypted as defined by the [encryption protocol](./encryption.md).

## Provider API

The Provider MUST implement:

```ts
interface RequestArguments {
  readonly method: string;
  readonly params?: readonly unknown[] | object;
}

provider.request(args: RequestArguments): Promise<unknown>
provider.on(event: string, listener: (...args: unknown[]) => void): Provider
provider.removeListener(event: string, listener: (...args: unknown[]) => void): Provider
```

`request()` is the only required RPC entry point. A successful call resolves
with the method result itself, not a JSON-RPC response object. A failed call
rejects with a `ProviderRpcError`.

For ecosystem compatibility, a Provider SHOULD also implement `addListener()`
as an alias of `on()` and `once()`. Legacy `send()` and `sendAsync()` are not
part of this protocol.

## Channel messages

The encrypted WebSocket application frame is:

```text
<sealed>@<caip-2-chain-id>
```

For Ethereum mainnet:

```text
<sealed>@eip155:1
```

CAIP-2 uses `namespace:reference`, so `eip155:1` is valid and `eip155-1` is
not. The EIP-155 reference is the decimal chain ID without leading zeroes. The
suffix is visible to the relay but is authenticated as AEAD additional data;
changing it makes decryption fail. Because canonical base64url never contains
`@`, the receiver splits the frame at its single `@` byte.

The following objects are the plaintext values inside `sealed`.

### Request

```json
{
  "id": "req-1",
  "method": "eth_getBalance",
  "params": ["0x0000000000000000000000000000000000000000", "latest"]
}
```

### Response

A response contains exactly one of `result` or `error`:

```json
{
  "id": "req-1",
  "result": "0x0"
}
```

```json
{
  "id": "req-1",
  "error": {
    "code": 4001,
    "message": "User rejected the request"
  }
}
```

### Event

```json
{
  "event": "chainChanged",
  "data": "0x1"
}
```

`id` MUST be a unique string of 1–128 printable-ASCII bytes (`0x20`–`0x7E`
inclusive) among the DApp's outstanding requests. The responder MUST copy it
unchanged and send exactly one response per request. A response whose `id`
matches no outstanding request MUST be discarded without erroring the channel; a
second response for an `id` whose response was already delivered MUST be
discarded; and a DApp MUST NOT reuse an `id` while a request bearing it is still
outstanding.
`method` MUST be a non-empty string of at most 128 UTF-8 bytes. `params`,
`result`, `error.data`, and event `data` MUST belong to the JSON data model.

The receiver identifies the message by its disjoint shape: a request has
`id`+`method`, a response has `id` and exactly one of `result` or `error`, and
an event has `event`+`data`. A message that matches more than one shape is
invalid. This channel envelope is not a JSON-RPC 2.0 envelope and therefore has
no `jsonrpc` field. A malformed request returns `-32600` when its `id` can be
recovered; otherwise it is discarded.

Requests flow from DApp to Wallet, responses and events from Wallet to DApp. An
implementation MAY answer account, chain, permission, or read-only methods
locally; externally visible results and errors MUST remain identical. A locally
answered method MUST return exactly what the Wallet would have returned — in
particular, a locally answered `wallet_getPermissions` or `eth_accounts` MUST
reflect the permissions the Wallet has actually granted, not a value assumed by
the DApp side.

The response MUST reuse the request's CAIP-2 suffix. For ordinary RPC and
signing methods, the suffix selects the request's chain context and any explicit
chain ID in `params` MUST match it. `eth_chainId` and `net_version` always return
the active chain; the Provider MUST send them with the active chain as the
suffix, so the suffix and the returned chain agree. A request whose suffix names
a chain the Wallet cannot service returns `4901`, or `4900` when no chain is
serviceable. For `wallet_switchEthereumChain`,
`wallet_addEthereumChain`, and multi-chain capability discovery, `params`
identifies the target chain while the suffix identifies the currently active
chain. A `chainChanged` event uses the new chain; other events use the chain to
which their data belongs.

### Request lifecycle

The relay is best-effort: it MAY drop a frame and does not replay past
application frames (see [relay](./relay.md)), so a response can be lost. To make
delivery recoverable without duplicating effects, the request `id` acts as an
idempotency key for the lifetime of the channel:

- On a retry the DApp MUST reuse the original `id`. The Wallet MUST NOT execute a
  state-changing request (`eth_sendTransaction`, `personal_sign`,
  `eth_signTypedData*`, `wallet_sendCalls`) more than once for the same `id`: if
  it already produced a result for that `id` it MUST return the same result, and
  if the operation is still in progress it MUST return that in-progress state
  rather than starting a second one. The Wallet retains this id→result mapping at
  least until the channel is abandoned.
- A DApp MUST NOT resubmit a state-changing request under a new `id` after a
  timeout, since the first submission may have taken effect; it MUST reconcile
  via the returned identifier (transaction hash or EIP-5792 bundle id) or surface
  the indeterminate outcome to the user.
- A DApp SHOULD apply a per-request timeout and, on timeout, retry with the same
  `id` a bounded number of times before erroring. Read-only and idempotent
  methods MAY be retried freely.
- The sequence rule (see [encryption](./encryption.md)) drops a reordered frame
  permanently, so per-request delivery is guaranteed only by this id-keyed retry,
  not by the transport.

## Supported methods

A conforming implementation MUST support the account, chain, permission,
signing, and sending methods listed below. Read-only RPC support is defined
separately and may depend on the selected chain endpoint.

### Accounts and chain

| Method | Behavior |
| --- | --- |
| `eth_requestAccounts` | Requests account access and returns the approved addresses. |
| `eth_accounts` | Returns only addresses authorized for this DApp, or `[]`. |
| `eth_chainId` | Returns the active EIP-155 chain ID as a canonical `Quantity`. |
| `net_version` | Returns the active network ID as a decimal string. |

Accounts MUST NOT be exposed before user authorization. Permissions are scoped
to the origin of the paired DApp `url`, not to an origin supplied in an RPC
request. The paired `url` is a self-declared fingerprint field, not an
authenticated web origin: the four-digit comparison authenticates only the QR
the currently trusted page displays, and each channel uses fresh ephemeral keys
with no cross-session cryptographic identity (see
[encryption](./encryption.md#security-properties-and-limits)). Therefore each new
pairing MUST obtain fresh, explicit user authorization; a Wallet MUST NOT
silently grant or reuse a persisted per-origin authorization for a new channel on
the basis of a matching `url`, `name`, or `icon` alone. A persisted per-origin
grant is a UX convenience only and is never proof of DApp identity.

### Network and permissions

| Method | Standard |
| --- | --- |
| `wallet_switchEthereumChain` | EIP-3326 |
| `wallet_addEthereumChain` | EIP-3085 |
| `wallet_getPermissions` | EIP-2255 |
| `wallet_requestPermissions` | EIP-2255 |

A successful chain switch returns `null`, updates `eth_chainId`, and emits
`chainChanged`. The Wallet MUST reject or cancel pending confirmations tied to
the previous chain. Adding a chain returns `null` but does not imply switching
to it. Chain metadata and RPC URLs are untrusted input and MUST be independently
validated by the Wallet. Switching or adding a chain requires explicit user
approval unless an existing permission policy already authorizes that action.

### Signing and sending

| Method | Behavior |
| --- | --- |
| `eth_sendTransaction` | Validates, authorizes, signs, and submits one transaction. |
| `personal_sign` | Signs `[data, address]` using the EIP-191 personal-message prefix. |
| `eth_signTypedData` | Legacy V1: params `[typedData, address]`, where `typedData` is the array-of-`{type,name,value}` form. |
| `eth_signTypedData_v1` | Alias of the legacy V1 method above; params `[typedData, address]`. |
| `eth_signTypedData_v3` | Params `[address, typedData]`, where `typedData` is the EIP-712 payload as a JSON **string**; V3 omits arrays and nested structs. |
| `eth_signTypedData_v4` | Params `[address, typedData]`, where `typedData` is the EIP-712 payload as a JSON **string**; supports arrays and nested structs. |
| `wallet_sendCalls` | Submits an EIP-5792 call bundle. |
| `wallet_getCallsStatus` | Returns the EIP-5792 status of a submitted bundle. |

EIP-5792 implementations MUST also support `wallet_getCapabilities` so the DApp
can discover chain-specific call capabilities. `wallet_showCallsStatus` is
OPTIONAL. Status information MUST be returned only for bundles visible to the
paired DApp.

The typed-data methods are ecosystem compatibility methods, not separate
finalized EIPs; the parameter orders and payload encodings above match the
established MetaMask ecosystem methods, which a Wallet MUST follow exactly. Note
that the unsuffixed and `_v1` order (`[typedData, address]`) is the reverse of
the `_v3`/`_v4` order (`[address, typedData]`), and that `_v3`/`_v4` pass the
payload as a JSON string while the legacy form passes the array object. Versions
V1 and V3 lack later security improvements; DApps SHOULD use `_v4`. A Wallet MUST
use the exact requested version and parameter shape and MUST NOT silently fall
back to another signing algorithm or reorder parameters.

Every signing or sending request MUST use an authorized account. The Wallet
MUST validate the complete request and obtain user approval according to its
policy; it MUST NOT trust summaries supplied by the DApp. Method parameters and
return values otherwise follow their defining standard or established method
version exactly and MUST NOT be silently reordered or converted.

### Read-only RPC

The Provider MAY service Ethereum node methods that neither use private keys,
change Wallet state, nor submit data to the network. The base read-only set is:

```text
web3_clientVersion
eth_syncing
eth_blockNumber
eth_call
eth_estimateGas
eth_createAccessList
eth_gasPrice
eth_maxPriorityFeePerGas
eth_feeHistory
eth_getBalance
eth_getCode
eth_getStorageAt
eth_getProof
eth_getTransactionCount
eth_getBlockByHash
eth_getBlockByNumber
eth_getBlockTransactionCountByHash
eth_getBlockTransactionCountByNumber
eth_getTransactionByHash
eth_getTransactionByBlockHashAndIndex
eth_getTransactionByBlockNumberAndIndex
eth_getTransactionReceipt
eth_getLogs
```

Read calls without an explicit chain target use the active chain. They MAY be
answered by a selected RPC endpoint instead of crossing the WalletPair channel. A
"selected" endpoint is one the implementation or user configured, or one
discovered from an untrusted source and admitted only after the checks below;
either way it is relied on for liveness only, not for data integrity — a read
result may be wrong or stale, so security decisions MUST NOT depend on it (see
Security requirements). Before an endpoint answers any read call, the
implementation MUST confirm that a live `eth_chainId` query to that endpoint
returns the selected chain; this probe result MAY be cached per endpoint and
chain, but the cache SHOULD NOT exceed a few minutes and MUST be re-checked when
the configured endpoint set changes. An endpoint
whose reported `eth_chainId` differs from the selected chain, or that fails the
probe, MUST NOT be used. A liveness check that discards the returned chain does
not satisfy this requirement. An implementation MAY add other read methods through an
explicit allowlist. It MUST NOT infer safety from an `eth_` prefix or blindly
forward unknown methods.

`eth_sendRawTransaction` is not read-only: in the base protocol it is unsupported
and returns `4200`, and it MUST NOT be answered from the read-only RPC path or
signed on the DApp's behalf. Filter creation, subscriptions,
debug, trace, admin, mining, and transaction-pool methods are outside the base
protocol. `eth_subscribe` and `eth_unsubscribe` MAY be implemented as an
extension when the selected RPC transport supports subscriptions.

## Events

The Wallet sends these EIP-1193 events:

| Event | `data` |
| --- | --- |
| `connect` | `{ "chainId": "0x1" }` |
| `disconnect` | A `ProviderRpcError`; its code follows WebSocket `CloseEvent` status codes. |
| `chainChanged` | The new canonical hexadecimal chain ID. |
| `accountsChanged` | The complete new array returned by `eth_accounts`. |
| `message` | `{ "type": string, "data": unknown }` |

The Provider emits `connect` when it first becomes able to service requests for
at least one chain, and `disconnect` when it cannot service requests for any
chain. It MUST update local state before invoking event listeners and MUST emit
`chainChanged` or `accountsChanged` whenever the corresponding RPC result
changes.

For an Ethereum subscription notification, `message` data has this form:

```json
{
  "type": "eth_subscription",
  "data": {
    "subscription": "0x…",
    "result": {}
  }
}
```

## Errors

```ts
interface ProviderRpcError extends Error {
  code: number
  message: string
  data?: unknown
}
```

The following EIP-1193 codes are required:

| Code | Meaning |
| ---: | --- |
| `4001` | User rejected the request. |
| `4100` | The method or account is not authorized. |
| `4200` | The method is not supported. |
| `4900` | The Provider is disconnected from every chain. |
| `4901` | The requested chain is disconnected while another chain remains available. |

Malformed requests use `-32600`, invalid method parameters use `-32602`, and
unexpected internal failures use `-32603`. Upstream EIP-1474 and EIP-5792
error codes SHOULD be preserved when they accurately describe the failure. An
unsupported or unknown method MUST return `4200`; it MUST NOT be forwarded
speculatively.

When a valid response the Wallet generates would exceed the encryption protocol's
64 KiB plaintext limit, the responder returns `-32005` (`Limit exceeded`) instead
of the oversized response. This is the same EIP-1474 `Limit exceeded` code, so a
`-32005` a read proxy receives verbatim from an upstream node (for example, rate
limiting) is likewise surfaced as `-32005`; both tell the DApp to reduce scope or
retry. A wallet-state method that can return an unbounded result (for example
`wallet_getCallsStatus` with many receipts) SHOULD support pagination so a
legitimate response can fit. A *request* whose plaintext would exceed 64 KiB
cannot be transmitted at all: it fails locally at the sender's encryption layer
and never reaches the Wallet.

A read that cannot be serviced because no endpoint for the selected chain is
available returns `4901`, or `4900` when no chain is serviceable; such a failure
MUST NOT be reported as `-32601`, which is not a WalletPair error code.

## Security requirements

- Treat the DApp and every method parameter as untrusted input; validate type,
  size, address, chain, calldata, and method-specific constraints.
- Display the actual decoded account, chain, value, target, calldata, typed-data
  domain, and calls being authorized. Do not sign based only on DApp-provided
  labels or summaries.
- Reject a signing address that is not currently authorized. For EIP-712,
  clearly warn or reject when the domain chain ID conflicts with the requested
  or active chain.
- Rate-limit requests and bound RPC execution time and response size. Read-only
  RPC calls may still leak addresses, calldata, IP information, and usage
  patterns to the selected endpoint.
- Never expose private keys, seed material, or unencrypted signing payloads to
  the relay. Protocol errors are returned as encrypted response payloads and do
  not close the channel unless the underlying channel is no longer usable.

## References

- [EIP-1193: Ethereum Provider JavaScript API](https://eips.ethereum.org/EIPS/eip-1193)
- [EIP-1102: Opt-in Account Exposure](https://eips.ethereum.org/EIPS/eip-1102)
- [EIP-1474: Ethereum RPC](https://eips.ethereum.org/EIPS/eip-1474)
- [EIP-191: Signed Data](https://eips.ethereum.org/EIPS/eip-191)
- [EIP-2255: Wallet Permissions](https://eips.ethereum.org/EIPS/eip-2255)
- [EIP-3085: Add Ethereum Chain](https://eips.ethereum.org/EIPS/eip-3085)
- [EIP-3326: Switch Ethereum Chain](https://eips.ethereum.org/EIPS/eip-3326)
- [EIP-712: Typed Structured Data](https://eips.ethereum.org/EIPS/eip-712)
- [EIP-5792: Wallet Call API](https://eips.ethereum.org/EIPS/eip-5792)
- [CAIP-2: Blockchain ID](https://standards.chainagnostic.org/CAIPs/caip-2)
- [MetaMask signing-method compatibility](https://docs.metamask.io/metamask-connect/evm/guides/sign-data/)
