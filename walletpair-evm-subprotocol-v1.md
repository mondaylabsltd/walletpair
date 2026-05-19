# WalletPair EVM Sub-Protocol v1

Status: Draft

This document defines the EVM (Ethereum Virtual Machine) sub-protocol for
WalletPair Protocol v1. It specifies the methods, parameters, results, error
codes, and events that a WalletPair-compatible EVM wallet must support.

This sub-protocol applies to all EIP-155 compatible chains including Ethereum,
Polygon, Arbitrum, Optimism, BSC, Avalanche, Base, and any other EVM chain.

## 1. Scope

This sub-protocol defines:

- chain and account identifier format
- wallet methods and their request/response schemas
- wallet events and their data schemas
- error codes
- capability declaration

This sub-protocol does not define:

- transport details (handled by WalletPair Protocol v1)
- key exchange or encryption (handled by WalletPair Protocol v1)
- specific smart contract ABIs
- token standards or metadata

## 2. Chain Identification

EVM chains use the `eip155` CAIP-2 namespace:

```text
eip155:<chain_id>
```

Examples:

| Chain | CAIP-2 |
|-------|--------|
| Ethereum Mainnet | `eip155:1` |
| Goerli Testnet | `eip155:5` |
| Sepolia Testnet | `eip155:11155111` |
| Polygon | `eip155:137` |
| Arbitrum One | `eip155:42161` |
| Optimism | `eip155:10` |
| BSC | `eip155:56` |
| Avalanche C-Chain | `eip155:43114` |
| Base | `eip155:8453` |

The `chain_id` is the decimal integer from [EIP-155](https://eips.ethereum.org/EIPS/eip-155).

## 3. Account Identification

Accounts use the CAIP-10 format:

```text
eip155:<chain_id>:<address>
```

Example:

```text
eip155:1:0xab16a96D359eC26a11e2C2b3d8f8B8942d5Bfcdb
```

When a method operates on a specific chain, the `chain` field in the request
params specifies which chain. Addresses are always hex-encoded with the `0x`
prefix and should follow EIP-55 mixed-case checksum encoding.

## 4. Capabilities

An EVM wallet declares its capabilities in the WalletPair `join` message:

```json
{
  "capabilities": {
    "methods": [
      "wallet_getAccounts",
      "wallet_signTransaction",
      "wallet_sendTransaction",
      "wallet_signMessage",
      "wallet_signTypedData",
      "wallet_switchChain",
      "wallet_addChain",
      "wallet_watchAsset"
    ],
    "events": [
      "accountsChanged",
      "chainChanged",
      "connect",
      "disconnect"
    ],
    "chains": [
      "eip155:1",
      "eip155:137",
      "eip155:42161"
    ]
  }
}
```

A wallet must support at least `wallet_getAccounts`. All other methods are
optional. The dApp should check `capabilities.methods` before calling any
method and should check `capabilities.chains` before assuming chain support.

## 5. Methods

All methods use the WalletPair `req` / `res` message flow. The `method` field
in the `req` message is the method name. Parameters are encrypted in the
`sealed` field. The decrypted content of `sealed` is the `params` object (for
requests) or the `result` / `error` object (for responses).

### 5.1 wallet_getAccounts

Returns the list of accounts the wallet is willing to expose to the dApp.
This is typically called immediately after `ready.connected` to discover
available addresses.

**Method:** `wallet_getAccounts`

**Params:**

```json
{
  "chain": "eip155:1"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | string | no | CAIP-2 chain. If omitted, return accounts for all supported chains. |

**Result:**

```json
{
  "accounts": [
    {
      "address": "0xab16a96D359eC26a11e2C2b3d8f8B8942d5Bfcdb",
      "chains": ["eip155:1", "eip155:137", "eip155:42161"]
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `accounts` | Account[] | List of accounts. |
| `accounts[].address` | string | EIP-55 checksummed hex address. |
| `accounts[].chains` | string[] | CAIP-2 chains this account is available on. |

**Errors:** `unauthorized`, `internal_error`

### 5.2 wallet_signTransaction

Signs a transaction without broadcasting it. Returns the signed transaction
bytes. The dApp is responsible for submitting the signed transaction to the
network.

**Method:** `wallet_signTransaction`

**Params:**

```json
{
  "chain": "eip155:1",
  "from": "0xab16a96D359eC26a11e2C2b3d8f8B8942d5Bfcdb",
  "tx": {
    "to": "0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41",
    "value": "0xde0b6b3a7640000",
    "data": "0x",
    "gas": "0x5208",
    "maxFeePerGas": "0x2540be400",
    "maxPriorityFeePerGas": "0x3b9aca00",
    "nonce": "0x0",
    "type": "0x2",
    "chainId": "0x1"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | string | yes | CAIP-2 chain identifier. |
| `from` | string | yes | Sender address (EIP-55). |
| `tx` | object | yes | Transaction object. |
| `tx.to` | string | no | Recipient address. Omit for contract creation. |
| `tx.value` | string | no | Value in wei, hex-encoded. Default `"0x0"`. |
| `tx.data` | string | no | Call data, hex-encoded. Default `"0x"`. |
| `tx.gas` | string | no | Gas limit, hex-encoded. Wallet may estimate if omitted. |
| `tx.gasPrice` | string | no | Gas price for legacy (type 0) transactions. |
| `tx.maxFeePerGas` | string | no | Max fee for EIP-1559 (type 2) transactions. |
| `tx.maxPriorityFeePerGas` | string | no | Priority fee for EIP-1559 transactions. |
| `tx.nonce` | string | no | Nonce, hex-encoded. Wallet may determine if omitted. |
| `tx.type` | string | no | Transaction type: `"0x0"` (legacy), `"0x1"` (EIP-2930), `"0x2"` (EIP-1559). |
| `tx.chainId` | string | no | Chain ID, hex-encoded. Must match `chain` if provided. |
| `tx.accessList` | array | no | EIP-2930 access list. |

**Result:**

```json
{
  "signature": "0x...",
  "signedTx": "0x..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `signature` | string | The signature bytes (r, s, v), hex-encoded. |
| `signedTx` | string | The full RLP-encoded signed transaction, hex-encoded. Ready to submit via `eth_sendRawTransaction`. |

**Errors:** `user_rejected`, `unauthorized`, `invalid_params`, `unsupported_chain`, `internal_error`

### 5.3 wallet_sendTransaction

Signs and broadcasts a transaction. Returns the transaction hash. This is the
most common method — dApps typically use this instead of `wallet_signTransaction`
unless they need custom submission logic.

**Method:** `wallet_sendTransaction`

**Params:** Same as `wallet_signTransaction`.

**Result:**

```json
{
  "txHash": "0xabc123..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `txHash` | string | Transaction hash, hex-encoded (32 bytes). |

The wallet submits the signed transaction to its own RPC endpoint. The dApp
can monitor the transaction using the returned hash.

**Errors:** `user_rejected`, `unauthorized`, `invalid_params`, `unsupported_chain`, `insufficient_funds`, `nonce_too_low`, `gas_estimation_failed`, `tx_rejected`, `internal_error`

### 5.4 wallet_signMessage

Signs an arbitrary message using [EIP-191](https://eips.ethereum.org/EIPS/eip-191)
personal sign (`\x19Ethereum Signed Message:\n` prefix).

**Method:** `wallet_signMessage`

**Params:**

```json
{
  "chain": "eip155:1",
  "address": "0xab16a96D359eC26a11e2C2b3d8f8B8942d5Bfcdb",
  "message": "Hello, WalletPair!"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | string | yes | CAIP-2 chain. |
| `address` | string | yes | Signing address. |
| `message` | string | yes | UTF-8 message to sign. |

**Result:**

```json
{
  "signature": "0x..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `signature` | string | 65-byte signature (r + s + v), hex-encoded. |

**Errors:** `user_rejected`, `unauthorized`, `invalid_params`, `internal_error`

### 5.5 wallet_signTypedData

Signs typed structured data using [EIP-712](https://eips.ethereum.org/EIPS/eip-712).

**Method:** `wallet_signTypedData`

**Params:**

```json
{
  "chain": "eip155:1",
  "address": "0xab16a96D359eC26a11e2C2b3d8f8B8942d5Bfcdb",
  "typedData": {
    "types": {
      "EIP712Domain": [
        { "name": "name", "type": "string" },
        { "name": "version", "type": "string" },
        { "name": "chainId", "type": "uint256" },
        { "name": "verifyingContract", "type": "address" }
      ],
      "Mail": [
        { "name": "from", "type": "string" },
        { "name": "to", "type": "string" },
        { "name": "contents", "type": "string" }
      ]
    },
    "primaryType": "Mail",
    "domain": {
      "name": "Example DApp",
      "version": "1",
      "chainId": 1,
      "verifyingContract": "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC"
    },
    "message": {
      "from": "Alice",
      "to": "Bob",
      "contents": "Hello!"
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | string | yes | CAIP-2 chain. |
| `address` | string | yes | Signing address. |
| `typedData` | object | yes | EIP-712 typed data object (same schema as `eth_signTypedData_v4`). |

**Result:**

```json
{
  "signature": "0x..."
}
```

**Errors:** `user_rejected`, `unauthorized`, `invalid_params`, `internal_error`

### 5.6 wallet_switchChain

Requests the wallet to switch its active chain. If the wallet supports
the requested chain, it switches and emits a `chainChanged` event.

**Method:** `wallet_switchChain`

**Params:**

```json
{
  "chain": "eip155:137"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | string | yes | CAIP-2 chain to switch to. |

**Result:**

```json
{
  "chain": "eip155:137"
}
```

Returns the chain that was switched to. The wallet should also emit a
`chainChanged` event.

**Errors:** `user_rejected`, `unsupported_chain`, `internal_error`

### 5.7 wallet_addChain

Requests the wallet to add a new EVM chain to its configuration.

**Method:** `wallet_addChain`

**Params:**

```json
{
  "chain": "eip155:8453",
  "chainName": "Base",
  "nativeCurrency": {
    "name": "Ether",
    "symbol": "ETH",
    "decimals": 18
  },
  "rpcUrls": ["https://mainnet.base.org"],
  "blockExplorerUrls": ["https://basescan.org"],
  "iconUrls": ["https://example.com/base-icon.png"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | string | yes | CAIP-2 chain to add. |
| `chainName` | string | yes | Human-readable chain name. |
| `nativeCurrency` | object | yes | Native currency info. |
| `nativeCurrency.name` | string | yes | Currency name. |
| `nativeCurrency.symbol` | string | yes | Currency symbol (2-6 characters). |
| `nativeCurrency.decimals` | number | yes | Number of decimals (usually 18). |
| `rpcUrls` | string[] | yes | At least one RPC endpoint URL. |
| `blockExplorerUrls` | string[] | no | Block explorer URLs. |
| `iconUrls` | string[] | no | Chain icon URLs. |

**Result:**

```json
{
  "added": true
}
```

If the chain already exists in the wallet, the wallet may update the RPC
URLs and return `{"added": true}` without prompting the user.

**Errors:** `user_rejected`, `invalid_params`, `internal_error`

### 5.8 wallet_watchAsset

Requests the wallet to track a token (ERC-20, ERC-721, or ERC-1155).

**Method:** `wallet_watchAsset`

**Params:**

```json
{
  "chain": "eip155:1",
  "type": "ERC20",
  "contract": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "symbol": "USDC",
  "decimals": 6,
  "image": "https://example.com/usdc.png"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | string | yes | CAIP-2 chain. |
| `type` | string | yes | Token standard: `"ERC20"`, `"ERC721"`, or `"ERC1155"`. |
| `contract` | string | yes | Token contract address. |
| `symbol` | string | no | Token symbol. |
| `decimals` | number | no | Token decimals (required for ERC-20). |
| `image` | string | no | Token icon URL. |
| `tokenId` | string | no | Token ID (required for ERC-721 and ERC-1155). |

**Result:**

```json
{
  "added": true
}
```

**Errors:** `user_rejected`, `invalid_params`, `internal_error`

## 6. Events

Events are sent from the wallet to the dApp using the WalletPair `evt`
message. The `event` field is the event name. The event data is encrypted
in the `sealed` field.

### 6.1 accountsChanged

Emitted when the wallet's exposed accounts change (user switches account,
adds or removes account access).

**Event:** `accountsChanged`

**Data:**

```json
{
  "accounts": [
    {
      "address": "0xNewAddress...",
      "chains": ["eip155:1", "eip155:137"]
    }
  ]
}
```

The dApp should update its local state and may call `wallet_getAccounts`
for a full refresh if needed.

### 6.2 chainChanged

Emitted when the wallet's active chain changes.

**Event:** `chainChanged`

**Data:**

```json
{
  "chain": "eip155:137"
}
```

### 6.3 connect

Emitted when the wallet establishes connectivity to a chain's RPC endpoint.

**Event:** `connect`

**Data:**

```json
{
  "chain": "eip155:1"
}
```

### 6.4 disconnect

Emitted when the wallet loses connectivity to a chain's RPC endpoint.

**Event:** `disconnect`

**Data:**

```json
{
  "chain": "eip155:1",
  "code": 4900,
  "message": "Disconnected from chain"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `chain` | string | CAIP-2 chain. |
| `code` | number | Error code (4900 = disconnected). |
| `message` | string | Human-readable message. |

## 7. Error Codes

When a method fails, the wallet responds with `res.ok = false`. The
decrypted `sealed` contains an error object:

```json
{
  "code": "user_rejected",
  "message": "User rejected the transaction"
}
```

Standard error codes:

| Code | Meaning | When to Use |
|------|---------|-------------|
| `user_rejected` | User declined the request in wallet UI. | User tapped reject/cancel. |
| `unauthorized` | DApp is not authorized for this account or method. | Account not exposed to dApp. |
| `invalid_params` | Request parameters are malformed or missing. | Bad address, missing field. |
| `unsupported_chain` | Wallet does not support the requested chain. | Chain not in capabilities. |
| `unsupported_method` | Wallet does not support the requested method. | Method not in capabilities. |
| `insufficient_funds` | Account balance too low for the transaction. | Not enough ETH/token. |
| `nonce_too_low` | Transaction nonce is already used. | Stale nonce. |
| `gas_estimation_failed` | Wallet could not estimate gas for the transaction. | Reverted in estimation. |
| `tx_rejected` | Network rejected the transaction. | RPC returned error. |
| `chain_not_added` | Requested chain is not configured in wallet. | Unknown chain ID. |
| `internal_error` | Unexpected wallet error. | Catch-all. |

The `code` field is a string (not a number) to allow namespaced extensions.
Wallet implementations may define additional error codes prefixed with their
namespace (e.g., `metamask:snap_error`).

## 8. Wire Format Examples

All examples show the decrypted content of the `sealed` field. On the wire,
these JSON objects are encrypted and base64url-encoded in the `sealed` field
of the WalletPair message.

### DApp requests accounts

WalletPair message (wire):

```json
{
  "v": 1,
  "t": "req",
  "ch": "aabb...eeff",
  "id": "req-001",
  "from": "base64url-dapp-pubkey",
  "method": "wallet_getAccounts",
  "sealed": "<encrypted params>"
}
```

Decrypted `sealed` (params):

```json
{
  "chain": "eip155:1"
}
```

### Wallet responds with accounts

WalletPair message (wire):

```json
{
  "v": 1,
  "t": "res",
  "ch": "aabb...eeff",
  "id": "req-001",
  "from": "base64url-wallet-pubkey",
  "ok": true,
  "sealed": "<encrypted result>"
}
```

Decrypted `sealed` (result):

```json
{
  "accounts": [
    {
      "address": "0xab16a96D359eC26a11e2C2b3d8f8B8942d5Bfcdb",
      "chains": ["eip155:1", "eip155:137"]
    }
  ]
}
```

### DApp sends transaction

WalletPair message (wire):

```json
{
  "v": 1,
  "t": "req",
  "ch": "aabb...eeff",
  "id": "req-002",
  "from": "base64url-dapp-pubkey",
  "method": "wallet_sendTransaction",
  "sealed": "<encrypted params>"
}
```

Decrypted `sealed` (params):

```json
{
  "chain": "eip155:1",
  "from": "0xab16a96D359eC26a11e2C2b3d8f8B8942d5Bfcdb",
  "tx": {
    "to": "0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41",
    "value": "0xde0b6b3a7640000",
    "data": "0x",
    "type": "0x2",
    "chainId": "0x1"
  }
}
```

### Wallet responds with tx hash

```json
{
  "txHash": "0x6b17a7a5f05676c30edb0dbb66c1b3c86e2b0e6c20f39a53e021ec36bf3b9f7a"
}
```

### User rejects a signing request

WalletPair message (wire):

```json
{
  "v": 1,
  "t": "res",
  "ch": "aabb...eeff",
  "id": "req-003",
  "from": "base64url-wallet-pubkey",
  "ok": false,
  "sealed": "<encrypted error>"
}
```

Decrypted `sealed` (error):

```json
{
  "code": "user_rejected",
  "message": "User rejected the request"
}
```

### Wallet pushes chainChanged event

WalletPair message (wire):

```json
{
  "v": 1,
  "t": "evt",
  "ch": "aabb...eeff",
  "from": "base64url-wallet-pubkey",
  "event": "chainChanged",
  "sealed": "<encrypted data>"
}
```

Decrypted `sealed` (data):

```json
{
  "chain": "eip155:137"
}
```

## 9. Typical Session Flow

```text
1. DApp creates channel, wallet scans QR
2. Pairing (create → join → accept → ready.connected)
3. DApp calls wallet_getAccounts
   → wallet returns available addresses
4. DApp displays UI, user initiates action
5. DApp calls wallet_sendTransaction
   → wallet shows tx details, user confirms
   → wallet signs, broadcasts, returns txHash
6. Wallet detects chain switch
   → wallet sends chainChanged event
7. DApp calls wallet_signTypedData (e.g., permit)
   → wallet shows typed data, user confirms
   → wallet returns signature
8. User closes session
   → either side sends close
```

## 10. Versioning and Extension

This sub-protocol is versioned independently from WalletPair Protocol v1.
The sub-protocol version is not carried in wire messages — it is implied
by the method names and parameter schemas.

To add new methods:

1. Define the method name, params, result, and error codes.
2. Add it to the wallet's `capabilities.methods` list.
3. DApps check capabilities before calling.

Wallets should ignore unknown methods gracefully and return an error with
code `unsupported_method`.

Custom methods may use a namespace prefix:

```text
myapp_customMethod
uniswap_getQuote
```

This allows experimentation without conflicting with standard methods.

## 11. Relationship to Existing Standards

| Standard | Relationship |
|----------|-------------|
| [EIP-155](https://eips.ethereum.org/EIPS/eip-155) | Chain ID format. |
| [EIP-191](https://eips.ethereum.org/EIPS/eip-191) | Personal message signing (`wallet_signMessage`). |
| [EIP-712](https://eips.ethereum.org/EIPS/eip-712) | Typed data signing (`wallet_signTypedData`). |
| [EIP-1559](https://eips.ethereum.org/EIPS/eip-1559) | Type 2 transaction format. |
| [EIP-2930](https://eips.ethereum.org/EIPS/eip-2930) | Access list transactions. |
| [EIP-3085](https://eips.ethereum.org/EIPS/eip-3085) | Add chain (`wallet_addChain`). |
| [EIP-3326](https://eips.ethereum.org/EIPS/eip-3326) | Switch chain (`wallet_switchChain`). |
| [EIP-747](https://eips.ethereum.org/EIPS/eip-747) | Watch asset (`wallet_watchAsset`). |
| [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md) | Chain identifier format. |
| [CAIP-10](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-10.md) | Account identifier format. |

This sub-protocol intentionally aligns with the MetaMask / EIP JSON-RPC
conventions so that existing EVM wallet implementations can adopt WalletPair
with minimal changes to their signing and transaction logic.
