# WalletPair Protocol, version 2

WalletPair lets a DApp use a Wallet on another device. It defines the functions a DApp can call on a Wallet, each with a name, an input and an output, and the events a Wallet sends back. Everything underneath is the transport's job: relays, pairing, end-to-end encryption, reconnection and reliable delivery.

This version covers EVM chains only.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as described in RFC 2119.

## 1. Transport

WalletPair runs over **PeerConnect protocol version 1**. A WalletPair session is a PeerConnect room:

| | DApp | Wallet |
|---|---|---|
| PeerConnect role | inviter | joiner |
| Starts with | `Room.create(relay)` | `Room.join(invite)` |

- **Relay.** Any PeerConnect v1 relay. The DApp picks one and the invite carries it. WalletPair does not run relays.
- **Pairing URI.** The DApp shows `walletpair:` followed by the PeerConnect invite, as a QR code or a link:

  ```text
  walletpair:wss://relay.example.com#q3V0…
  ```

  The Wallet removes the `walletpair:` prefix and joins the room with the rest. Until the room is paired, the invite is a bearer credential (PeerConnect §8.3), so the DApp shows it only on its own screen.
- **Messages.** Each PeerConnect message carries one WalletPair message: a JSON object (RFC 8259) encoded as UTF-8. A receiver ignores a message that is not a JSON object, and ignores members it does not know.
- **Ending.** Either side ends the session by closing the room (PeerConnect §5.5). Going offline, or leaving the room for now, does not end it.
- **Storage.** Each side keeps its room record as PeerConnect requires. The record is a secret: whoever holds it can act as that side.

PeerConnect delivers every message once, in order, and holds messages while the other side is offline. WalletPair therefore has no retries, sequence numbers or timeouts of its own, except where a process restart breaks that guarantee (§5).

## 2. Messages

Only the DApp sends requests. Only the Wallet sends responses and events.

### Request (DApp → Wallet)

```json
{ "id": "6f1c2a90-…", "method": "personal_sign", "params": ["0x68656c6c6f", "0xd8da6bf26964af9d7eed9e03e53415d37aa96045"], "origin": "https://app.example" }
```

| Member | |
|---|---|
| `id` | String of 1–128 characters, unique for the life of the room. DApps SHOULD use a random value such as a UUID, because a restarted DApp cannot know which ids it used before. |
| `method` | The function name (§3). |
| `params` | The function's input. Omitted when the function takes none. |
| `origin` | Optional. The web origin the request comes from, when one DApp side serves several sites (for example a browser extension). The Wallet shows it to the user. The DApp side asserts it; nobody verifies it. |

### Response (Wallet → DApp)

Exactly one per request, carrying either `result` or `error`:

```json
{ "id": "6f1c2a90-…", "result": "0x5d5f…1b" }
```

```json
{ "id": "6f1c2a90-…", "error": { "code": 4001, "message": "User rejected the request" } }
```

`error.data` is optional. A DApp ignores a response whose `id` it is not waiting for.

A Wallet answers a request it cannot parse with `-32600` if it can read the `id`, and ignores it otherwise. It answers a `method` it does not support with `4200`.

### Event (Wallet → DApp)

```json
{ "event": "chainChanged", "data": "0x89" }
```

## 3. Functions

Values use Ethereum's JSON-RPC encoding (EIP-1474). Addresses and byte strings are `0x`-prefixed hex. A chain ID is a `0x`-prefixed hex quantity without leading zeros, such as `0x1` or `0x89`.

### 3.1 `walletpair_connect`

Starts the session: the DApp introduces itself and asks for accounts, and the Wallet asks the user to approve.

Input:

```json
[{ "name": "Example DApp", "url": "https://app.example", "icon": "https://app.example/icon.png" }]
```

`name` is required, 1–128 characters. `url` (an `https:` URL) and `icon` (an `https:` or `data:image/` URL) are optional.

Output:

```json
{
  "wallet": { "name": "Example Wallet", "icon": "https://wallet.example/icon.png" },
  "eip155": { "accounts": ["0xd8da6bf26964af9d7eed9e03e53415d37aa96045"], "chainId": "0x1" }
}
```

- `wallet.name` is required and `wallet.icon` is optional.
- `eip155.accounts` holds at least one address, in the Wallet's order of preference.
- `eip155.chainId` is the active chain.

Errors: `4001` if the user declines.

The DApp sends `walletpair_connect` first. It sends it again every time it starts from a saved room, and the output is the Wallet's current state. If the user has already approved the room and has not revoked that approval, the Wallet answers at once without asking again. Until the user approves, the Wallet answers every other request with `4100`.

Approval belongs to the room. The DApp's `name`, `url` and `icon` are its own claims, so a Wallet MUST NOT approve a new room because those values match a room approved earlier.

### 3.2 Wallet functions

| Function | Input (`params`) | Output (`result`) | Defined by |
|---|---|---|---|
| `wallet_switchEthereumChain` | `[{ chainId }]` | `null` | EIP-3326 |
| `wallet_addEthereumChain` | `[{ chainId, chainName, nativeCurrency, rpcUrls, blockExplorerUrls? }]` | `null` | EIP-3085 |
| `personal_sign` | `[data, address]` | signature | EIP-191 |
| `eth_signTypedData_v4` | `[address, typedData]`, where `typedData` is a JSON **string** | signature | EIP-712 |
| `eth_sendTransaction` | `[transaction]` | transaction hash | EIP-1474 |
| `wallet_sendCalls` | `[{ version, chainId, from?, atomicRequired, calls, capabilities? }]` | `{ id, capabilities? }` | EIP-5792 |
| `wallet_getCallsStatus` | `[id]` | status of the call bundle | EIP-5792 |
| `wallet_getCapabilities` | `[address, chainIds?]` | capabilities per chain | EIP-5792 |

Inputs and outputs are exactly as the defining standard specifies; the summaries above are not normative. In addition:

- **Accounts.** An address in the input MUST be one of the approved accounts. Otherwise the Wallet answers `4100`.
- **Chain.** When a transaction's `chainId`, or an EIP-712 `domain.chainId`, is not the active chain, the Wallet answers `4901` and does nothing. A DApp SHOULD set the transaction's `chainId` to the chain it believes is active. Then a request that crossed a `chainChanged` in transit cannot act on the wrong chain.
- **Switching.** When `wallet_switchEthereumChain` succeeds, the Wallet sends `chainChanged` before the response. Because PeerConnect delivers in order, the DApp has the new chain by the time the call returns. A chain the Wallet does not know returns `4902`. EIP-3326 does not define this code, but DApps expect it. The DApp can then call `wallet_addEthereumChain`, which adds the chain without switching to it.
- **Reads.** `wallet_getCallsStatus` and `wallet_getCapabilities` only read. Every other function has an effect and requires the user's approval according to the Wallet's policy.

### 3.3 Events

| Event | `data` | Sent when |
|---|---|---|
| `accountsChanged` | The approved accounts, in the same form as `walletpair_connect`'s `eip155.accounts`, or `[]` | The accounts or their order change |
| `chainChanged` | The new chain ID | The active chain changes |

Each event carries the whole new value, so receiving the same event twice is harmless. An empty `accountsChanged` revokes the approval but keeps the room; the DApp must call `walletpair_connect` again. When the session ends, the room is closed; there is no disconnect event.

## 4. The DApp side: EIP-1193 provider

A DApp side usually exposes WalletPair as an EIP-1193 provider. It handles calls as follows:

| EIP-1193 call | Handled by |
|---|---|
| `eth_requestAccounts` | `walletpair_connect` while not approved; the approved accounts afterwards |
| `eth_accounts` | The approved accounts, or `[]` (answered locally) |
| `eth_chainId`, `net_version` | The active chain from the last `walletpair_connect` or `chainChanged` (answered locally) |
| Functions in §3.2 | Forwarded to the Wallet |
| Read-only node methods (`eth_call`, `eth_getBalance`, …) | The DApp side's own RPC endpoint. These are not part of WalletPair. |
| Anything else | `4200` |

The provider:

- emits `connect` when `walletpair_connect` succeeds;
- emits `accountsChanged` and `chainChanged` only when the value actually changes;
- emits `disconnect` with code `4900`, and rejects pending requests with `4900`, when the room ends.

While the Wallet is offline, requests wait because PeerConnect holds them. A provider MAY reject a request with `4900` after a timeout of its choosing.

A DApp side that serves several sites, such as a browser extension, authorizes each site itself before showing it any accounts. It sends each request with that site's `origin`.

## 5. Restarts

While both sides keep running, PeerConnect delivers every message exactly once. A restart weakens this in two ways:

- A side that restarts loses the messages it had sent but not yet had acknowledged.
- A side that restarts may receive again the messages it received just before it stopped.

To handle this:

- A Wallet MUST NOT act twice on the same request `id`. For every function with an effect (§3.2), it stores the response it gave, under the request `id`, for the life of the room, and keeps it across restarts. When the same `id` arrives again, it sends that stored response. If the first request is still waiting for the user, it sends nothing more.
- A DApp that has waited a long time for a response MAY send the request again, unchanged and with the same `id`. It MUST NOT resend it under a new `id`, because the first request may already have taken effect.
- A DApp that restarts has lost its pending requests and ignores the responses that arrive for them. It then sends `walletpair_connect` to get the current state.
- A Wallet that restarts sends `accountsChanged` and `chainChanged` with their current values once the room is approved, because events it had queued before the restart may be lost.

## 6. Errors

| Code | Meaning |
|---:|---|
| `4001` | The user rejected the request. |
| `4100` | Not authorized: the room has not been approved, or the address is not an approved account. |
| `4200` | Unsupported function. |
| `4900` | Disconnected: the room has ended. Returned by the DApp side. |
| `4901` | The request names a chain that is not the active chain. |
| `4902` | Unknown chain (`wallet_switchEthereumChain`). An ecosystem convention, not part of EIP-3326. |
| `-32600` | Invalid request. |
| `-32602` | Invalid params. |
| `-32603` | Internal error. |

Errors defined by EIP-5792 (`5700`–`5760`) keep their codes.

## 7. Security

- **Transport.** The relay and the network are untrusted. PeerConnect keeps message contents confidential and authentic (PeerConnect §8). The relay sees timing, message sizes and network addresses.
- **Invite.** Until the room is paired, whoever uses the invite first becomes the Wallet. If someone else gets there first, the real Wallet never connects: the race is visible but not prevented (PeerConnect §8.3).
- **Claims.** `name`, `url`, `icon` and `origin` are unverified labels, and Wallets show them as such.
- **Inputs.** Wallets treat every input as untrusted. They check types, addresses and chains, and show the user the decoded transaction, message or typed data, never a summary supplied by the DApp.
- **Records.** Room records hold keys. Store them like passwords and delete them when the room ends.

## References

- PeerConnect protocol, version 1
- [EIP-1193: Ethereum Provider JavaScript API](https://eips.ethereum.org/EIPS/eip-1193)
- [EIP-1474: Remote procedure call specification](https://eips.ethereum.org/EIPS/eip-1474)
- [EIP-191: Signed Data Standard](https://eips.ethereum.org/EIPS/eip-191)
- [EIP-712: Typed structured data hashing and signing](https://eips.ethereum.org/EIPS/eip-712)
- [EIP-3085: wallet_addEthereumChain](https://eips.ethereum.org/EIPS/eip-3085)
- [EIP-3326: wallet_switchEthereumChain](https://eips.ethereum.org/EIPS/eip-3326)
- [EIP-5792: Wallet Call API](https://eips.ethereum.org/EIPS/eip-5792)
