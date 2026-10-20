# WalletPair for Solana (`solana`)

This network specification adds Solana to [WalletPair Core](../core.md). It defines the namespace's chains and accounts, its functions, and how a DApp side exposes them as a Wallet Standard wallet.

## 1. Namespace

| | |
|---|---|
| Namespace | `solana` |
| Chain | A CAIP-2 chain ID: `solana:` followed by the first 32 characters of the cluster's genesis hash in base58. |
| Account | An Ed25519 public key in base58: 32 to 44 characters that decode to exactly 32 bytes. |

This version supports these clusters, shown with the identifiers Solana's Wallet Standard uses for them:

| Cluster | Chain | Wallet Standard |
|---|---|---|
| Mainnet | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | `solana:mainnet` |
| Devnet | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | `solana:devnet` |
| Testnet | `solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z` | `solana:testnet` |

A cluster without a fixed genesis hash, such as a local validator, has no chain ID and is not supported.

**Encodings.** Byte strings (transactions, messages, signatures) are standard base64 with padding (RFC 4648 §4). Addresses are base58 (Bitcoin alphabet), as everywhere in Solana.

## 2. Functions

| Function | Input (`params`) | Output (`result`) |
|---|---|---|
| `solana_signTransactions` | `{ account, transactions, chain? }` | `{ transactions }` |
| `solana_signAndSendTransaction` | `{ account, transaction, chain, options? }` | `{ signature }` |
| `solana_signMessage` | `{ account, message }` | `{ signature }` |

All three have an effect (Core §6), and `account` MUST be an approved account; otherwise the Wallet answers `4100`. When `chain` is given and is not the active chain, the Wallet answers `4901`.

### 2.1 Transactions

A transaction is the serialized transaction in Solana's wire format, at most 1,232 bytes. This version supports **legacy** and **version 0** transactions:

- legacy and v0 start with a compact-u16 signature count `n`, then `n` 64-byte signatures, then the message. A v0 message starts with the byte `0x80`; a legacy message does not have the high bit set in its first byte;
- the message header's first byte is `numRequiredSignatures`, and the first `numRequiredSignatures` static account keys are the signers.

The Wallet answers `-32602` for a transaction that does not parse, that is not legacy or v0 (version 1 transactions start with `0x81`), whose signature count differs from `numRequiredSignatures`, or in which `account` is not among the signers. It signs the message bytes with the account's key and writes the signature into that account's slot only, leaving every other signature as it was. It does not otherwise change the transaction.

**`solana_signTransactions`** signs each transaction in `transactions` (1 to 16 base64 strings) and returns them signed, in the same order, as `transactions`. It succeeds for all or fails for all. `chain`, when given, is the cluster the DApp intends them for.

**`solana_signAndSendTransaction`** signs one transaction and submits it to the cluster named by `chain`, which is required. `options` may carry `preflightCommitment`, `commitment` (`processed`, `confirmed` or `finalized`), `skipPreflight` (boolean), `maxRetries` and `minContextSlot` (non-negative integers), with the meanings of Solana's `sendTransaction`. It returns the transaction's first signature, which is its ID, as base64 `signature`. A Wallet SHOULD simulate the transaction before asking the user, and SHOULD warn when simulation fails.

### 2.2 Messages

**`solana_signMessage`** signs `message` (base64, 1 to 65,536 bytes once decoded) with the account's Ed25519 key and returns the 64-byte signature as base64 `signature`. The Wallet signs exactly the given bytes; it does not prefix or change them.

So that a message can never be a transaction in disguise, the Wallet answers `-32602` when the message is not valid UTF-8, or when it parses as a transaction or a transaction message (legacy or v0). It shows the user the message as text.

Not part of this version, so a Wallet answers `4200`: Sign In With Solana (`signIn`) and off-chain messages. A DApp side without `signIn` is expected to connect and then use `solana_signMessage`, as Solana's wallet adapter already does.

## 3. The DApp side: Wallet Standard

A DApp side exposes this namespace as a Wallet Standard wallet, registered with the `wallet-standard:register-wallet` and `wallet-standard:app-ready` events. It offers these features:

| Feature | Handled by |
|---|---|
| `standard:connect` | `walletpair_connect` with `solana` among its namespaces, unless `solana` is already approved. With `silent: true` it never prompts and returns only accounts already approved. |
| `standard:disconnect` | Locally: the site stops seeing accounts. The session is not changed. |
| `standard:events` | `change` with the new `accounts` whenever the `solana` accounts in the state change. |
| `solana:signTransaction` (versions `legacy`, `0`) | `solana_signTransactions` with every input that shares an account and chain, so that one call covers `signAllTransactions`. |
| `solana:signAndSendTransaction` (versions `legacy`, `0`) | `solana_signAndSendTransaction`, once per input. |
| `solana:signMessage` | `solana_signMessage`, once per input. Returns `signedMessage` equal to the input message and `signatureType` `ed25519`. |

Every account lists all of these features and the Wallet Standard identifiers of all three clusters as its `chains`; the Wallet decides which cluster is active and answers `4901` for another. The DApp side converts a Wallet Standard `chain` to the chain ID in §1 before forwarding. A DApp side keeps the same account objects as long as the accounts do not change, since applications compare them by identity.

## References

- [Wallet Standard](https://github.com/wallet-standard/wallet-standard)
- [Solana Wallet Standard features](https://github.com/anza-xyz/wallet-standard)
- [Solana transactions](https://solana.com/docs/core/transactions)
- [Versioned transactions](https://solana.com/docs/core/transactions/versioned-transactions)
- [CAIP-2 for Solana](https://github.com/ChainAgnostic/namespaces/blob/main/solana/caip2.md)
