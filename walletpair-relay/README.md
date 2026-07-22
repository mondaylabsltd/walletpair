# WalletPair Relay

An intentionally minimal WebSocket echo server for local WalletPair relay development.

```sh
cargo run
```

Connect a WebSocket client to `ws://127.0.0.1:3000/ws`. Text and binary frames are sent back unchanged.
