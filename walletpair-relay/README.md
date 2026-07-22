# WalletPair Relay

An intentionally minimal WebSocket relay for local WalletPair development.

```sh
cargo run
```

Connect to a 64-character hexadecimal channel ID, for example:

```text
ws://127.0.0.1:3000/v1?ch=0140446dc1742a90025fcd068df3a7338314e1da1649d520798c8581a0937d0c
```

Text and binary frames are broadcast to every active connection on the same channel (including the sender). Connections on other channels receive nothing. A channel is removed automatically when its last client disconnects.
