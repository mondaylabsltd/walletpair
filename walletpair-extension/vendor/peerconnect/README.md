# PeerConnect JavaScript client (vendored)

WalletPair's transport. This directory is the built `js/` package of PeerConnect, copied unmodified because PeerConnect is not yet published to a registry.

| | |
|---|---|
| Source | PeerConnect repository, commit `4614295bb5fc89a51ed8203beb19a3c1cbb38ec5` (2026-10-20) |
| Protocol | PeerConnect v1 |
| Built with | Rust 1.97.1, `wasm-bindgen` 0.2.129 (matching its `Cargo.lock`), `wasm-opt` 132 |
| Verified | PeerConnect's own `js` test suite passed against this build (4/4, including interop with its Rust client) |
| License | MIT (PeerConnect is MIT OR Apache-2.0) |

Files: `index.js` and `index.d.ts` (the API), `dist/peerconnect.js` and `dist/peerconnect.d.ts` (wasm-bindgen bindings), `dist/module.js` (the WebAssembly module, inlined as base64).

## Updating

From a clean checkout of the PeerConnect commit you want:

```sh
WASM_BINDGEN=/path/to/wasm-bindgen WASM_OPT=/path/to/wasm-opt sh js/scripts/build.sh
(cd js && npm test)   # needs `cargo build -p peerconnect-relay` and the `chat` example first
cp js/index.js js/index.d.ts <here>/
cp js/dist/peerconnect.js js/dist/peerconnect.d.ts js/dist/module.js <here>/dist/
```

Then update the commit above. Replace this directory with a package dependency once PeerConnect is published.
