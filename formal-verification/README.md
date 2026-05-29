# WalletPair Protocol v1 — Formal Verification

ProVerif models for the WalletPair Protocol v1 key exchange and
encrypted messaging. The models verify security properties under the
Dolev-Yao attacker model, where the relay (network) is fully
adversarial.

## Files

| File | Description |
|------|-------------|
| `walletpair-v1.pv` | Full model: key exchange, sealed_join, directional traffic keys, sequence-numbered AEAD, known limitations |
| `walletpair.pv` | Earlier model (kept for reference) |

## Prerequisites

Install ProVerif (version 2.04 or later):

```bash
# macOS (Homebrew)
brew install proverif

# From source (requires OCaml)
# https://bblanche.gitlabpages.inria.fr/proverif/
```

## Running

```bash
proverif walletpair-v1.pv
```

ProVerif prints `RESULT` lines for each query. All should show `true`
(property holds) or `cannot be proved` with an explanation.

## What Each Query Proves

### Confidentiality (Q1-Q3)

```
Query not attacker(secretReq)    — Q1
Query not attacker(secretRes)    — Q2
Query not attacker(secretEvt)    — Q3
```

The relay cannot learn plaintext request, response, or event content.
Maps to spec Section 19.1: "MUST NOT be able to read request
parameters, response results, or event data."

### Authentication (Q4-Q7)

```
event(WalletRecvReq(ch,m)) ==> event(DAppSentReq(ch,m))     — Q4
event(DAppRecvRes(ch,m))   ==> event(WalletSentRes(ch,m))    — Q5
event(DAppRecvEvt(ch,m))   ==> event(WalletSentEvt(ch,m))    — Q6
event(DAppVerifiedJoin(ch,wpk)) ==> event(WalletSentJoin(ch,wpk)) — Q7
```

- **Q4**: If the wallet decrypts a request, the dApp sent it.
- **Q5**: If the dApp decrypts a response, the wallet sent it.
- **Q6**: If the dApp decrypts an event, the wallet sent it.
- **Q7**: If the dApp successfully verifies sealed_join, the wallet
  actually created it (proving control of the matching private key).

### Replay Protection (Q8)

```
event(WalletAcceptedSeq(ch,s)) ==> event(DAppAcceptedSeq(ch,s)) — Q8
```

The sequence number is bound into the AEAD nonce derivation
(HMAC-SHA256) and included in the AAD. Replaying a ciphertext with a
different sequence number causes AEAD decryption failure. This models
spec Section 6.6.1.

### Key Separation (Q9)

```
event(DAppRecvRes(ch,m)) ==> event(WalletSentRes(ch,m))  — Q9 (same as Q5)
```

The dapp_to_wallet_key and wallet_to_dapp_key are derived with
different HKDF info strings, modeled as distinct functions `hkdf_d2w`
and `hkdf_w2d`. In ProVerif's symbolic model, these are structurally
different terms, so `hkdf_d2w(k, t)` can never equal `hkdf_w2d(k, t)`.

This prevents reflection attacks: an attacker cannot take a request
encrypted with d2w_key and present it as a response (which requires
w2d_key). If keys were identical, the attacker could bounce a dApp
request back as a fake response, violating Q5/Q9.

### Transcript Binding (Q10)

```
event(DAppTranscriptHash(ch,th1)) && event(WalletTranscriptHash(ch,th2))
  ==> th1 = th2                                            — Q10
```

Traffic keys depend on the transcript hash, which includes the
decrypted sealed_join content. If the relay tampers with sealed_join
content, the dApp derives a different transcript hash (and therefore
different traffic keys) than the wallet. All subsequent AEAD
operations fail because the keys disagree.

## Known Limitations (modeled but not "fixed")

These are inherent to the protocol design and are documented in the
spec.

### L1: No Forward Secrecy

Keys are per-channel, derived from a single X25519 DH exchange. If a
peer's private key is compromised, all messages on that channel (past
and future) are compromised. The protocol does not perform per-message
key ratcheting.

To verify: uncomment `LeakDAppKey()` in the model and observe that
Q1-Q3 (confidentiality) fail.

### L2: Relay Can DoS

The relay can drop messages, terminate sessions, or refuse to forward
the join. This is a liveness issue, not a safety issue. ProVerif
verifies trace properties (safety), not liveness. The spec
acknowledges this in Section 19.5.

### L3: Fake Wallet Attack

A malicious relay can generate its own X25519 key pair and send a
join before the real wallet (race condition). The dApp pairs with the
relay's fake wallet. This is acknowledged in spec Section 6.7 and
19.2.

To verify: uncomment `FakeWalletAttack()` and run with only `DApp()`
(no honest wallet). The attacker successfully pairs, demonstrating
that initial join is not proof of user identity.

## Model Design Notes

- **Dolev-Yao attacker**: The `net` channel is public. The attacker
  can intercept, inject, modify, drop, reorder, and replay any
  message on it.

- **QR out-of-band**: The `qr` channel is private. The attacker
  cannot read or modify the pairing URI.

- **First-join-wins**: The `relayJoin` channel is private, modeling
  the relay's guarantee that only the first join is forwarded. The
  join is also published on `net` so the attacker can observe it.

- **Sequence numbers**: Modeled via `aead_enc_seq` / `aead_dec_seq`
  constructors that bind the sequence number into the ciphertext.
  Decryption requires the correct sequence number.

- **Unbounded sessions**: The `!` replication operator allows ProVerif
  to reason about an arbitrary number of concurrent sessions.
