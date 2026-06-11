---
"walletpair-sdk": major
---

Remove the Bluetooth (BLE) transport. WalletPair is now relay-only.

**Breaking changes**

- Removed the `walletpair-sdk/ble` subpath export and everything it contained
  (`WebBleCentralTransport`, `isWebBleSupported`, `frameMessage`, `Defragmenter`,
  `BLE_SERVICE_UUID`, `BLE_WRITE_CHAR_UUID`, `BLE_NOTIFY_CHAR_UUID`,
  `DEFAULT_FRAME_PAYLOAD`, `MIN_FRAME_PAYLOAD`).
- `PairingParams.relay` is now a required `string` (was optional). The WebSocket
  relay is the WalletPair transport, so the pairing URI always carries a `relay`
  parameter.
- `buildPairingUri()` now requires `relayUrl` and always emits the `relay`
  parameter; `parsePairingUri()` throws when `relay` is absent (§8.1).
- `DAppSession` now requires a relay-backed transport that exposes a `url`
  (e.g. `WebSocketTransport`); it throws otherwise.
- Removed the BLE-only `onBeforeTransportConnect` option from the wagmi connector
  (`walletpair-sdk/evm/wagmi`).

**Migration**: use `WebSocketTransport` (the default and only transport). Remove
any imports from `walletpair-sdk/ble` and any `onBeforeTransportConnect` usage.
