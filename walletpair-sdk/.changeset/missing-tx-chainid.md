---
"walletpair-sdk": patch
---

EVM provider: stop rejecting `eth_sendTransaction` / `eth_signTransaction` when the transaction omits `chainId`. Some dApps (e.g. PancakeSwap) switch networks first via `wallet_switchEthereumChain` and then send a transaction with no embedded `tx.chainId`, relying on the wallet's active chain — exactly like MetaMask. The provider now fills the missing `tx.chainId` from the current session chain and derives the top-level `chain` param from the resolved id so the wallet always receives a complete, chain-consistent request (`tx.chainId` matches `chain`, per EVM sub-protocol §6.2). When the dApp does embed `tx.chainId`, it is honored and `chain` is derived from it.
