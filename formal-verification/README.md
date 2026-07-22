# ProVerif model

[`encryption.pv`](./encryption.pv) is a symbolic model of
[`protocols/encryption.md`](../protocols/encryption.md). It includes an active
Dolev–Yao attacker that controls the relay/network and may read, drop, replay,
reorder, modify, or inject frames. The DApp still pins the first joiner, so the
model also permits an attacker to win that race. The honest DApp and Wallet
processes, their private keys, and the local comparison display are trusted.

Run it with ProVerif 2.05:

```sh
opam exec -- proverif formal-verification/encryption.pv
```

The checked model returns `true` for all three queries.

The model asks ProVerif to prove:

1. a successful Wallet code comparison binds all five fingerprint fields to
   the tuple displayed by an honest DApp;
2. every DApp message accepted by the Wallet was encrypted by that DApp for
   that Wallet, with injective correspondence for the modeled frame; and
3. Wallet application data sent immediately after the code comparison and key
   derivation remains secret; no explicit DApp confirmation is assumed.

The model uses ideal X25519, HKDF, hashing, MessagePack, and AEAD primitives. A
successful human comparison is modeled as an authentic and collision-free
step. Consequently, the proof is conditional on no four-digit-code collision;
it does **not** prove a `1/10000` probability bound. In particular, an attacker
that learns the genuine code before choosing replacement pairing data can
search offline for a colliding tuple in roughly 10,000 trials.

The `relay` URI field is not part of the five-field fingerprint and is not
modeled as authenticated. An attacker may replace the relay and thereby observe
metadata or deny/redirect transport, but ideal AEAD still prevents it from
forging a message under the pinned DApp key.

ProVerif also does not establish parser limits, rejection of X25519's all-zero
output, atomic counter persistence across crashes, the `2^31` limit, or correct
counter arithmetic. The model accepts only one sequence value per role
instance; the injective query checks that this modeled frame cannot be accepted
twice. The full monotonic-counter behavior must be covered by implementation
tests and crash/reconnect tests.
