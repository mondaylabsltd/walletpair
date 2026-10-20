# WalletPair v2: status

Living document for the move to WalletPair v2: what the project is, what state it is in, what has been decided and why, and what remains. Updated at every step.

Branch: `v2-peerconnect`. Owner instructions (2026-10-20): WalletPair stops running its own relay and transport and becomes a specification of DApp↔Wallet functions over PeerConnect. The repository keeps the specification, the browser extension and the website. Networks: EVM, TRON and Solana, in the specification and in the extension.

## 1. Assessment (start of v2)

### What the protocol is for

A web DApp on a computer uses a Wallet on a phone: the user scans a QR code once, and from then on the DApp's signing requests reach the phone, which answers them. Design ideas from v1 that remain: no registration or project IDs, an untrusted relay, end-to-end encryption, the browser extension as the DApp side so existing DApps work unchanged.

Target environments: Chromium (MV3 service worker) and Firefox extension; the static website on Cloudflare Workers; any Wallet that can run a PeerConnect client (JavaScript, Rust, or WebAssembly).

### What existed at the start (main @ 7587681)

| Part | State |
|---|---|
| `protocols/relay.md`, `encryption.md`, `ethereum.md` | v1 specs. Detailed and carefully revised (two audit rounds), but most of their content (relay routing, X25519/HKDF/ChaCha20 framing, MessagePack profile, persisted sequence counters, frame size limits, id-keyed retries over a lossy relay) is transport that PeerConnect now provides better. |
| `walletpair-relay/` | Rust/Axum relay with its own channel model, deployed at `relay.walletpair.org`. |
| `formal-verification/` | ProVerif model of the v1 channel only. |
| `walletpair-extension/` | v1 DApp side: EIP-1193 + EIP-6963 provider, QR pairing, its own crypto, MV3 recovery, per-origin permissions, activity log, read-only RPC proxy. EVM only. |
| `walletpair.org/` | Docs site plus an in-browser playground implementing v1 a second time (`protocol.ts`). |
| Untracked leftovers | `walletpair-sdk/`, `walletpair-examples/`, `walletpair-websocket-relay*/` from older branches (13 GB, not in git). |

### Spec versus implementation

v1 spec and v1 extension had been aligned in PR #3. Both are superseded by v2, so their differences no longer matter. The decision of which side is right is moot: v2 starts from the specification and the extension is rewritten to it.

### Published, and who depends on it

- GitHub releases: extension v0.1.1 (latest), relay v0.1.0; `relay.walletpair.org` in production.
- npm: `walletpair-sdk` up to 1.1.0, an SDK the repository already removed in PR #2.
- Public repository, 0 stars, 0 forks; no known third-party Wallet implements v1.

v2 is wire-incompatible with v1 (different transport, different pairing URI). The owner asked for this change explicitly, and the compatibility cost is low. A v1 Wallet rejects a v2 URI and vice versa (Core §9).

## 2. Plan and progress

| # | Step | State |
|---|---|---|
| 1 | Remove v1 relay, transport specs, formal model, playground; trim site | done (`50ddd16`) |
| 2 | Assessment and status document | done |
| 3 | Core specification (`spec/core.md`) | drafted |
| 4 | Network specifications: EVM, TRON, Solana | EVM drafted; TRON, Solana researching |
| 5 | PeerConnect client vendored into the extension, reproducibly built | done |
| 6 | Shared protocol module + conformance vectors (`spec/test-vectors/`) | |
| 7 | Reference Wallet for tests (all three networks, real signing) | |
| 8 | Extension rewrite on PeerConnect: session, EVM, TRON, Solana providers | |
| 9 | End-to-end tests: real Chrome + extension + real relay + reference Wallet | |
| 10 | Firefox build and run; website on Cloudflare runtime locally | |
| 11 | Website content for v2 | |
| 12 | Final review, limitations, report | |

## 3. Decisions

| Decision | Why | Cost |
|---|---|---|
| WalletPair is messages only; PeerConnect is the transport. | Owner's direction. PeerConnect already provides everything v1's transport did, plus exactly-once delivery and pairing that moves rooms off the invite. | Breaks v1 (see above). |
| No 4-digit pairing code. | v1's code authenticated QR fields to the page showing them; anyone able to replace the QR on that page can replace the code too, and the extension shows its QR in its own UI. PeerConnect pins the inviter's key from the invite; a lost race is visible (the Wallet never connects). | One less user step; the residual race is documented (Core §8). |
| JSON over PeerConnect, 1 MiB per message. | Text, debuggable, universal. MessagePack's only benefit was size, irrelevant at these volumes. 1 MiB bounds what a phone must parse; PeerConnect's 16 MiB is far more than any function needs. | Base64 for binary inputs (Solana) costs a third more bytes. |
| One `state` event with the whole session state, instead of per-network `accountsChanged`/`chainChanged`. | Works for every namespace with one rule; idempotent; DApp sides derive their provider events by comparing. | DApp sides must diff. |
| `walletpair_connect` returns the state per namespace, keyed by CAIP-2 namespace, chains as CAIP-2 IDs. | One shape for every network; the extension can ask for all three at once. | EVM functions still use hex chain IDs (EIP-3326), so the EVM spec defines the mapping. |
| `walletpair_cancel`. | PeerConnect queues requests while the phone is offline. Without cancel, a request whose page closed long ago would appear as a prompt later, and a DApp that retried could make the user act twice. In-order delivery means a cancel always arrives after its request, so an offline Wallet never shows it. | One more function. |
| Wallet records responses of effectful requests per session; DApp side resends pending requests after reconnecting. | PeerConnect is exactly-once only while both sides run; across a restart a request can repeat and a response can be lost. Recording before the effect is irreversible prevents double sends. | Wallet storage grows with the session (small: signatures, hashes, signed transactions). |
| Approval belongs to the session, never to a name or URL. | DApp metadata is self-asserted. | Each new pairing asks once. |
| `origin` member on requests. | One extension session serves many sites; the Wallet must be able to show which site asks to sign. | Unverified label, documented as such. |
| Vendor the built PeerConnect JS client into the extension. | PeerConnect is not published; vendoring builds in CI without network access to an unpublished repo, and pins an exact, tested commit. | Manual update (documented in `walletpair-extension/vendor/peerconnect/README.md`); replace with a package once published. |
| Default relay URL: placeholder. | The owner will decide which PeerConnect relay WalletPair defaults to. | The extension needs it before release. |

## 4. Open questions for the owner

1. Default PeerConnect relay URL for the extension.
2. Publishing PeerConnect (npm) so the vendored copy can become a dependency.
3. What happens to `relay.walletpair.org` (v1) once v2 ships.

## 5. Known limitations

(Filled in as work proceeds.)
