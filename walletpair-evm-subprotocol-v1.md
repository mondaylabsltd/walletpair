# WalletPair EVM Sub-Protocol v1

Status: Release Candidate

This document defines the EVM sub-protocol for WalletPair Protocol v1.
It applies to all EIP-155 compatible chains.

For transport, encryption, and pairing, see `walletpair-protocol-v1.md`.
For sub-protocol authoring guidance, see Appendix B of that document.

## 1. Namespace and Version

| Item | Value |
|------|-------|
| Namespace | `evm` |
| Version | `1` |
| CAIP-2 prefix | `eip155` |
| Method prefix | `wallet_` |

Declared in `capabilities.version`:

```json
{ "version": { "evm": 1 } }
```

## 2. Chain Identification

Format: `eip155:<chain_id>` where `<chain_id>` is the decimal integer
from EIP-155. Examples: `eip155:1` (Ethereum), `eip155:137` (Polygon),
`eip155:42161` (Arbitrum), `eip155:8453` (Base).

Transaction objects use hex chain IDs (`"0x1"`); this sub-protocol
uses CAIP-2 decimal (`"eip155:1"`). When both are present, the wallet
MUST verify they match. On mismatch, reject with `invalid_params`.

## 3. Account Identification

Addresses are 20-byte hex with `0x` prefix (42 characters). Wallet
responses MUST use EIP-55 checksum. Comparison MUST be
case-insensitive. The zero address MUST NOT be used as a signer.

## 4. Capabilities

```json
{
  "capabilities": {
    "version": { "evm": 1 },
    "methods": [
      "wallet_getAccounts",
      "wallet_signTransaction",
      "wallet_sendTransaction",
      "wallet_signMessage",
      "wallet_signTypedData",
      "wallet_switchChain"
    ],
    "events": [
      "accountsChanged",
      "chainChanged",
      "disconnect"
    ],
    "chains": ["eip155:1", "eip155:137"]
  }
}
```

A wallet MUST support `wallet_getAccounts`. All other methods are
optional. The dApp MUST check `capabilities.methods` before calling.

## 5. Data Encoding

| Data type | Encoding |
|-----------|----------|
| Addresses | `0x` + 40 hex chars (20 bytes, EIP-55) |
| Values, nonce, gas, fees | `0x` hex string, no leading zeroes except `0x0` |
| Signed transactions | `0x` hex string (full RLP-encoded) |
| Signatures | `0x` hex string, 65 bytes (r: 32 + s: 32 + v: 1) |
| Call data, hashes | `0x` hex string |
| EIP-712 `domain.chainId` | JSON number (safe integer ≤ 2^53-1) |

## 6. Methods

Decrypted request: `{ "_method": "<name>", ...params }`. Decrypted
response: `{ "_ok": true, "_result": <value> }` or
`{ "_ok": false, "code": "<code>", "message": "..." }`.

### 6.1 wallet_getAccounts

Returns accounts authorized for this session. MUST NOT prompt.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | string | no | CAIP-2 chain filter. If omitted, return all. |

**Result:**

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

**Errors:** `unsupported_chain`, `internal_error`

### 6.2 wallet_signTransaction

Signs a transaction without broadcasting.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | string | yes | CAIP-2 chain. |
| `address` | string | yes | Sender address (EIP-55). |
| `tx` | object | yes | Transaction object (see below). |

**Transaction object:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | string | no | Recipient. Omit for contract creation. |
| `value` | string | no | Wei, hex. Default `"0x0"`. |
| `data` | string | no | Call data, hex. Default `"0x"`. |
| `gas` | string | no | Gas limit, hex. Wallet MAY estimate. |
| `nonce` | string | no | Nonce, hex. Wallet MAY determine. |
| `type` | string | no | `"0x0"`–`"0x4"` (legacy, EIP-2930, EIP-1559, EIP-4844, EIP-7702). |
| `chainId` | string | no | Hex chain ID. MUST match `chain`. |
| `gasPrice` | string | no | For type 0/1. |
| `maxFeePerGas` | string | no | For type 2/3/4. |
| `maxPriorityFeePerGas` | string | no | For type 2/3/4. MUST NOT exceed `maxFeePerGas`. |
| `accessList` | array | no | EIP-2930. Each: `{ address, storageKeys[] }`. |
| `maxFeePerBlobGas` | string | no | For type 3. |
| `blobVersionedHashes` | string[] | no | For type 3. 32-byte hex, `0x01` version prefix. |
| `authorizationList` | array | no | For type 4. Max 16 entries. Each: `{ chainId, address, nonce, yParity, r, s }`. |

**Validation:**

1. `address` MUST be authorized for this session and chain.
2. `chain` MUST be in `capabilities.chains`.
3. If `tx.chainId` present, MUST match `chain`. If absent, wallet
   sets it.
4. Fee fields MUST be consistent with `tx.type`. Type 3/4 MUST be
   explicit (not inferred).
5. Wallet MUST display: chain, recipient (or "Contract Creation"),
   value, gas estimate.

**Result:**

```json
{ "signedTx": "0x..." }
```

**Errors:** `user_rejected`, `unauthorized`, `invalid_params`,
`unsupported_chain`, `internal_error`

### 6.3 wallet_sendTransaction

Signs and broadcasts. Same params and validation as Section 6.2.

**Result:**

```json
{ "txHash": "0x..." }
```

Response means accepted by RPC, not mined. Blob transactions (type 3)
require sidecar data for broadcast; unless the wallet supports it, the
dApp MUST use `wallet_signTransaction` and broadcast itself.

**Errors:** `user_rejected`, `unauthorized`, `invalid_params`,
`unsupported_chain`, `insufficient_funds`, `nonce_too_low`,
`gas_estimation_failed`, `tx_rejected`, `internal_error`

### 6.4 wallet_signMessage

Signs UTF-8 text with EIP-191 personal sign prefix
(`\x19Ethereum Signed Message:\n<byte_length>`).

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | string | yes | CAIP-2 chain. |
| `address` | string | yes | Signing address. |
| `message` | string | yes | UTF-8 text. Always text, never hex-decoded. |

Wallet MUST display the full message. EIP-191 signatures are NOT
chain-bound; the wallet MUST warn the user. DApps needing chain-bound
signatures SHOULD use `wallet_signTypedData`.

**Result:**

```json
{ "signature": "0x..." }
```

**Errors:** `user_rejected`, `unauthorized`, `invalid_params`,
`internal_error`

### 6.5 wallet_signTypedData

Signs EIP-712 structured data.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | string | yes | CAIP-2 chain. |
| `address` | string | yes | Signing address. |
| `typedData` | object | yes | EIP-712 typed data (same schema as `eth_signTypedData_v4`). |

**Validation:**

1. `address` MUST be authorized, `chain` MUST be in capabilities.
2. `typedData.types` MUST contain `EIP712Domain`;
   `typedData.primaryType` MUST reference a defined type.
3. If `domain.chainId` present, MUST match `chain`. If absent and
   data is high-risk (Permit, PermitBatch, PermitSingle), MUST reject.
4. Wallet MUST display `domain.name`, `domain.verifyingContract`,
   `primaryType`, and key fields. MUST NOT blind-sign.
5. Wallet SHOULD warn on Permit and spending-allowance patterns.

**Result:**

```json
{ "signature": "0x..." }
```

**Errors:** `user_rejected`, `unauthorized`, `invalid_params`,
`internal_error`

### 6.6 wallet_switchChain

Switches active chain for this session only.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | string | yes | CAIP-2 target chain. |

**Result:**

```json
{ "chain": "eip155:137" }
```

Wallet MUST also emit `chainChanged`.

**Errors:** `user_rejected`, `unsupported_chain`, `internal_error`

## 7. Events

Decrypted content: `{ "_event": "<name>", ...data }`.

### 7.1 accountsChanged

```json
{ "_event": "accountsChanged",
  "accounts": [{ "address": "0x...", "chains": ["eip155:1"] }] }
```

Empty `accounts` = all access revoked.

### 7.2 chainChanged

```json
{ "_event": "chainChanged", "chain": "eip155:137" }
```

### 7.3 disconnect

Wallet-initiated session end. Distinct from transport-layer `close`:
`disconnect` is encrypted and carries a reason visible only to the
dApp. The wallet SHOULD send `disconnect` before `close`.

```json
{ "_event": "disconnect",
  "reason": "user_closed",
  "message": "User closed the wallet" }
```

Reasons: `"user_closed"`, `"session_revoked"`, `"wallet_locked"`.
On receipt, the dApp MUST NOT send further requests.

## 8. Error Codes

| Code | Meaning |
|------|---------|
| `user_rejected` | User declined in wallet UI. |
| `unauthorized` | Account not authorized for this session. |
| `invalid_params` | Malformed or missing parameters. |
| `unsupported_chain` | Chain not in capabilities. |
| `unsupported_method` | Method not in capabilities. |
| `insufficient_funds` | Balance too low. |
| `nonce_too_low` | Nonce already used. |
| `gas_estimation_failed` | Gas estimation reverted. |
| `tx_rejected` | Network rejected the transaction. |
| `internal_error` | Unexpected wallet error. |

Wallets MAY define namespaced extensions (e.g., `metamask:snap_error`).

## 9. Security Requirements

1. All signing and transaction methods MUST display a confirmation UI.
2. Wallet MUST NOT blind-sign transactions or EIP-712 data.
3. EIP-191 signatures are not chain-bound; wallet MUST warn users.
4. Wallet MUST detect and warn on Permit and spending-allowance
   patterns in EIP-712 data.
5. Account authorization and chain state are per-session.
6. When `chain` param and `tx.chainId` are both present, wallet MUST
   verify they match.
