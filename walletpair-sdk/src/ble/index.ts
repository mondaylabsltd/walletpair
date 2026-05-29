/**
 * BLE transport exports.
 *
 * Re-exports framing utilities and provides the Web Bluetooth Central transport.
 * Safe to import on any platform — Web Bluetooth availability is checked at runtime.
 */

export {
  BLE_NOTIFY_CHAR_UUID,
  BLE_SERVICE_UUID,
  BLE_WRITE_CHAR_UUID,
  DEFAULT_FRAME_PAYLOAD,
  Defragmenter,
  frameMessage,
  MIN_FRAME_PAYLOAD,
} from './framing.js'

export { isWebBleSupported, WebBleCentralTransport } from './web-ble-transport.js'
