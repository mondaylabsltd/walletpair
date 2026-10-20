# WalletPair Core, version 2

WalletPair lets a DApp use a Wallet on another device. It defines the functions a DApp calls on a Wallet, each with a name, an input and an output, and one event a Wallet sends back. This document defines what every network shares. Each network (EVM, TRON, Solana) adds its own functions in a [network specification](./README.md#networks).

WalletPair is carried by **PeerConnect** (protocol version 1). PeerConnect provides the relay, pairing, end-to-end encryption, reconnection and reliable, ordered delivery. WalletPair defines only the messages inside it, and runs no servers.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as described in RFC 2119.

## 1. Terms

| Term | Meaning |
|---|---|
| DApp side | The peer that asks: a web application, or a browser extension acting for web applications. PeerConnect inviter. |
| Wallet | The peer that holds keys and answers. PeerConnect joiner. |
| Session | A PeerConnect room between one DApp side and one Wallet. |
| Namespace | A family of networks, named as in CAIP-2: `eip155` (EVM), `tron`, `solana`. |
| Chain | One network in a namespace, as a CAIP-2 chain ID such as `eip155:1`. |
| Session state | What the DApp side may use: for each approved namespace, the active chain and the approved accounts (§4.2). |

## 2. Transport

### 2.1 Roles

| | DApp side | Wallet |
|---|---|---|
| PeerConnect role | inviter | joiner |
| Starts with | `Room.create(relay)` | `Room.join(invite)` |

Any PeerConnect v1 relay works. The DApp side picks one, and the invite carries it to the Wallet.

### 2.2 Pairing URI

The DApp side shows the PeerConnect invite after the prefix `walletpair:`, as a QR code or a link:

```text
walletpair:wss://relay.example.com#q3V0…
```

The Wallet removes the prefix and joins the room with the rest. A Wallet MUST reject a URI whose remainder is not a valid PeerConnect v1 invite; this is how a future incompatible version will be told apart (§9).

Until the room is paired, the invite is a bearer credential (PeerConnect §8.3). The DApp side shows it only on its own screen, or lets the user copy it, and never logs or sends it anywhere itself.

### 2.3 Messages on the wire

Each PeerConnect message carries exactly one WalletPair message: a JSON object (RFC 8259) encoded as UTF-8, without a byte order mark.

- A message MUST NOT exceed **1 MiB** (1,048,576 bytes). A receiver treats a larger one as malformed. (PeerConnect itself allows 16 MiB; WalletPair needs far less and bounds what a peer must parse.)
- A sender MUST NOT repeat a member name within an object.
- A receiver ignores object members it does not know.

### 2.4 Lifecycle

- **Ending.** Either side ends the session by closing the room (PeerConnect §5.5). When a side learns that the room is closed, the session is over: it forgets the room, and the Wallet forgets the session's approval and stored responses (§6).
- **Going offline** (leaving the room for now, a dropped connection, a sleeping phone) does not end the session. PeerConnect holds messages until the other side is back.
- **Storage.** Each side keeps its room record as PeerConnect requires. The record is a secret: whoever holds it can act as that side.

## 3. Messages

The DApp side sends requests. The Wallet sends responses and events. A Wallet ignores anything that is not a request; a DApp side ignores requests.

### 3.1 Request (DApp side → Wallet)

```json
{ "id": "6f1c2a90-3b7e-4d0a-9c55-1f0e8d2b7a41", "method": "personal_sign", "params": ["0x68656c6c6f", "0xd8da6bf26964af9d7eed9e03e53415d37aa96045"], "origin": "https://app.example" }
```

| Member | Rules |
|---|---|
| `id` | String of 1 to 128 printable ASCII characters (`0x20`–`0x7E`). Unique for the life of the session. A DApp side SHOULD use a random UUID: once restarted, it cannot know which ids it used before. |
| `method` | String of 1 to 128 printable ASCII characters: a function name (§5 and the network specifications). |
| `params` | The function's input, an array or an object as the function defines. Omitted when the function takes none. |
| `origin` | Optional. The `https:` or `http:` web origin the request comes from, serialized as browsers do (`scheme://host[:port]`, no path, at most 2,048 characters), when one DApp side serves several sites, as a browser extension does. The Wallet shows it to the user. The DApp side asserts it; nobody verifies it. |

### 3.2 Response (Wallet → DApp side)

Exactly one per request, with either `result` or `error`:

```json
{ "id": "6f1c2a90-3b7e-4d0a-9c55-1f0e8d2b7a41", "result": "0x5d5f…1b" }
```

```json
{ "id": "6f1c2a90-3b7e-4d0a-9c55-1f0e8d2b7a41", "error": { "code": 4001, "message": "User rejected the request" } }
```

`error.code` is an integer, `error.message` a string, and `error.data` is optional (§7). A DApp side ignores a response whose `id` it is not waiting for, and a second response for the same `id`.

### 3.3 Event (Wallet → DApp side)

```json
{ "event": "state", "data": { "eip155": { "chain": "eip155:1", "accounts": ["0xd8da6bf26964af9d7eed9e03e53415d37aa96045"] } } }
```

`event` is a string naming the event; `data` is defined by the event. The only event in this version is `state` (§4.3). A DApp side ignores events it does not know.

### 3.4 Receiving

A Wallet handles each message in this order, and stops at the first step that applies:

1. Not a JSON object, or over 1 MiB: ignore it.
2. `id` missing or invalid: ignore it, since there is no `id` to answer.
3. `method` missing or invalid, or `params` present but neither an array nor an object, or `origin` invalid: answer `-32600`.
4. An `id` the Wallet has recorded in this session (§6): send the recorded response again, or nothing while the first request is in progress.
5. Not yet approved (§4), and `method` is not `walletpair_connect` or `walletpair_cancel`: answer `4100`.
6. `method` unknown or not supported: answer `4200`.
7. `method` belongs to a namespace that is not approved: answer `4100`.
8. `params` invalid for the function: answer `-32602`.
9. Otherwise perform the function.

A DApp side treats an object with a string `event` member as an event, and an object with a valid `id` and exactly one of `result` or `error` as a response. It ignores anything else, and an event whose `data` is invalid.

## 4. Session

### 4.1 `walletpair_connect`

Starts the session: the DApp side introduces itself and asks for namespaces. The Wallet asks the user to approve.

Input:

```json
[{ "name": "Example DApp", "url": "https://app.example", "icon": "https://app.example/icon.png", "namespaces": ["eip155", "solana"] }]
```

| Member | Rules |
|---|---|
| `name` | Required. A display name (§4.4). |
| `url` | Optional. An `https:` URL (`http:` is allowed for `localhost` and `127.0.0.1`), at most 2,048 characters. |
| `icon` | Optional. An `https:` URL, or a base64 `data:` URL of a PNG, JPEG, WebP, GIF or SVG image (`data:image/png;base64,…`), at most 65,536 characters. |
| `namespaces` | Required. 1 to 16 distinct namespace names. |

Output:

```json
{
  "wallet": { "name": "Example Wallet", "icon": "https://wallet.example/icon.png" },
  "state": {
    "eip155": { "chain": "eip155:1", "accounts": ["0xd8da6bf26964af9d7eed9e03e53415d37aa96045"] },
    "solana": { "chain": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "accounts": ["7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv"] }
  }
}
```

`wallet.name` is a required display name and `wallet.icon` follows the rules for `icon` above. `state` is the session state (§4.2).

Errors: `4001` if the user declines; `4200` if the Wallet serves none of the requested namespaces.

The DApp side sends `walletpair_connect` first. It sends it again whenever it starts from a saved room, and whenever it wants more namespaces; the output is always the Wallet's current state.

The Wallet:

- shows the user the DApp's `name`, `url` and `icon`, and the namespaces it serves among those requested;
- answers at once, without asking again, when the user has already approved every requested namespace that the Wallet serves;
- otherwise asks about the namespaces not yet approved, and answers with the state for everything approved after that. If the user declines and nothing was approved before, it answers `4001`;
- shows at most one connection prompt per session, and answers every `walletpair_connect` waiting for it when the user decides.

Approval belongs to the session. The DApp's `name`, `url`, `icon` and `origin` are its own claims, so a Wallet MUST NOT approve a new session because they match a session approved before.

### 4.2 Session state

An object with one member per approved namespace:

| Member | Rules |
|---|---|
| `chain` | The namespace's active chain, as a CAIP-2 chain ID in the form the network specification defines. |
| `accounts` | 1 to 64 distinct account addresses in the network's canonical form, in the Wallet's order of preference. |

A namespace is approved exactly while it appears in the state. The state of an unapproved session is `{}`.

### 4.3 The `state` event

Whenever the session state changes, the Wallet sends a `state` event whose `data` is the complete new state. Because it carries the whole value, receiving it twice is harmless.

- A namespace that disappears from the state is no longer approved; an empty state revokes the approval of the whole session, which stays open. The DApp side then asks again with `walletpair_connect`.
- When a function changes the state (switching chains, for example), the Wallet sends the `state` event before the function's response. PeerConnect delivers in order, so the DApp side has the new state when the call returns.
- After a restart, a Wallet sends a `state` event with the current state, since events it had queued before may have been lost (PeerConnect §3.4).

### 4.4 Display names

`name` and `wallet.name` are shown to people, so they are restricted: 1 to 128 Unicode characters, no leading or trailing white space, no control characters (category Cc), and none of the bidirectional formatting characters U+061C, U+200E, U+200F, U+202A–U+202E and U+2066–U+2069, which can make one name look like another.

### 4.5 States

Wallet, for each session:

| State | Receives | Does |
|---|---|---|
| unapproved | `walletpair_connect` | Asks the user. Approve: answers with the state, becomes approved. Decline: `4001`. |
| unapproved | any other function except `walletpair_cancel` | `4100` |
| approved | `walletpair_connect` | §4.1 |
| approved | a function of an approved namespace | Performs it. |
| approved | a function of another namespace | `4100` |
| approved | the user revokes everything | Sends `state` with `{}`, becomes unapproved. |
| any | the room closes | Ends: cancels its prompts, forgets the session (§2.4). |

DApp side, for each session:

| State | Event | Does |
|---|---|---|
| connecting | `walletpair_connect` result | Keeps the state, becomes approved. |
| connecting | `walletpair_connect` error | Becomes unapproved. |
| approved | `state` | Replaces its state; `{}` makes it unapproved. |
| unapproved | — | Sends `walletpair_connect` when the user next asks to connect. |
| any | the room closes | Ends: answers every pending call with `4900`. |

A DApp side sends only `walletpair_connect` and `walletpair_cancel` until it is approved.

## 5. Core functions

| Function | Input | Output |
|---|---|---|
| `walletpair_connect` | §4.1 | §4.1 |
| `walletpair_cancel` | `[id]`: the `id` of an earlier request | `null` |

**`walletpair_cancel`** withdraws a request the DApp side no longer wants an answer to: the page that made it has closed, or the user gave up. PeerConnect delivers in order, so the cancellation always arrives after the request it names; a Wallet that was offline receives both together and never shows the request.

- If the request is still waiting for the user, the Wallet removes its prompt and answers the request with `4001`.
- If the request has already been answered, or the `id` is unknown, the cancellation changes nothing.
- Either way, it answers the cancellation with `null`.

A DApp side that keeps the ids of its pending requests across restarts SHOULD cancel them after restarting, since it can no longer use their answers.

The network specifications add the functions of each namespace. A function's name starts with a prefix that belongs to its namespace (for example `eth_` and `wallet_` for `eip155`), and a function belongs to exactly one namespace.

## 6. Restarts and repeated requests

PeerConnect delivers every message exactly once while both sides keep running. A restart weakens that in two ways:

- A side that restarts loses the messages it had sent but not yet had acknowledged.
- A side that restarts may receive again what it received just before it stopped.

So a request can arrive twice, and a response can be lost. WalletPair handles both with the request `id`:

- **The Wallet never acts twice.** For every function with an effect, which is every function a network specification does not mark as read-only, the Wallet records the request `id` and its response for the life of the session, durably. It makes the record durable *before* the effect can no longer be undone wherever it can: a transaction's hash, for example, is known before the transaction is broadcast. When an `id` it has recorded arrives again, it sends the recorded response again; if the first request is still in progress, it sends nothing more.
- **The DApp side asks again.** When its PeerConnect connection returns to `connected` after a break, a DApp side SHOULD send every request still waiting for an answer again, unchanged and with the same `id`. A Wallet that restarted and lost the response answers from its record. A DApp side MUST NOT send a request again under a new `id`, since the first one may have taken effect.
- **A DApp side that restarts** has lost its pending calls, and ignores the responses that arrive for them. It sends `walletpair_connect` to learn the current state, and cancels what it can (§5).
- **Read-only functions, `walletpair_connect` and `walletpair_cancel`** are not recorded; repeating them is harmless, so they are simply performed again.

There are no other timeouts in WalletPair. A Wallet MAY answer `4001` to a request the user leaves unanswered. A DApp side MAY give up on a call after a time of its choosing, and then cancels it (§5).

## 7. Errors

Errors use the codes of EIP-1193 and EIP-1474 across all namespaces:

| Code | Meaning |
|---:|---|
| `4001` | The user rejected the request, or it was cancelled (§5). |
| `4100` | Not authorized: the session or the namespace is not approved, or an account is not approved. |
| `4200` | Unsupported function or namespace. |
| `4900` | Disconnected: the session has ended. Produced by the DApp side for its callers; never sent by a Wallet. |
| `4901` | The request names a chain that is not the namespace's active chain. |
| `-32005` | Limit exceeded: too many requests are waiting for the user. |
| `-32600` | Invalid request (§3.4). |
| `-32602` | Invalid params. |
| `-32603` | Internal error. |

A network specification may add codes of its own. `error.message` is for people and MUST NOT be interpreted by programs.

## 8. Security

- **Transport.** The relay and the network are untrusted. PeerConnect keeps message contents confidential and authentic, and gives forward secrecy (PeerConnect §8). The relay sees timing, message sizes and network addresses.
- **Pairing.** Until the room is paired, whoever uses the invite first becomes the Wallet. If someone else does, the real Wallet never connects: the race is visible but not prevented (PeerConnect §8.3). After pairing only the two paired devices can reach the session.
- **Claims.** `name`, `url`, `icon` and `origin` are unverified labels, and Wallets present them as such. Approval belongs to the session, never to a name or URL (§4.1).
- **Inputs.** A Wallet treats every input as untrusted. It checks types, accounts and chains, and shows the user what will actually be signed or sent, decoded from the bytes it signs, never from a summary the DApp side supplied.
- **Resources.** A Wallet bounds what a session can make it hold: messages are at most 1 MiB, and it MAY refuse requests with `-32005` while too many wait for the user.
- **Records.** Room records hold keys. Each side stores them like passwords and deletes them when the session ends.

## 9. Evolution

- **Compatible changes** add functions, namespaces, events and members. Receivers ignore members and events they do not know, and a Wallet answers `4200` to a function it does not know, so a DApp side can tell what a Wallet supports by trying.
- **Incompatible changes** use a pairing URI that is not `walletpair:` followed by a PeerConnect v1 invite, which version 2 Wallets reject (§2.2). There is no in-session version negotiation.

WalletPair version 1 (its own relay and encryption, `walletpair:?ch=…` URIs) is not compatible with version 2.
