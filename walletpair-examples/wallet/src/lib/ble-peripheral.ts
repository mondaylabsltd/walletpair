/**
 * BLE Peripheral transport for WalletPair wallet.
 *
 * Uses our custom Expo native module (modules/ble-peripheral) which directly
 * calls Android BluetoothGattServer / iOS CBPeripheralManager with proper
 * Expo Modules event bridging. No broken NativeEventEmitter.
 *
 * Requires Expo dev build (npx expo prebuild + npx expo run:android/ios).
 */

import {
  BLE_SERVICE_UUID,
  BLE_WRITE_CHAR_UUID,
  BLE_NOTIFY_CHAR_UUID,
  frameMessage,
  Defragmenter,
} from './ble-framing';

export { BLE_SERVICE_UUID, BLE_WRITE_CHAR_UUID, BLE_NOTIFY_CHAR_UUID };

/** Encode Uint8Array to base64 (for native module). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Decode base64 to Uint8Array. */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// BLE Peripheral Transport
// ---------------------------------------------------------------------------

export class BlePeripheralTransport {
  private defragmenter = new Defragmenter();
  private subscribed = false;
  private started = false;
  private subscriptions: { remove(): void }[] = [];

  private _onMessage: ((msg: Record<string, unknown>) => void) | null = null;
  private _onConnected: (() => void) | null = null;
  private _onDisconnected: (() => void) | null = null;

  onMessage(handler: (msg: Record<string, unknown>) => void): void {
    this._onMessage = handler;
  }

  onConnected(handler: () => void): void {
    this._onConnected = handler;
  }

  onDisconnected(handler: () => void): void {
    this._onDisconnected = handler;
  }

  async start(): Promise<void> {
    await this.stop();

    // Lazy-load our custom Expo native module
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    let BleModule: typeof import('../../modules/ble-peripheral');
    try {
      BleModule = require('../../modules/ble-peripheral');
    } catch (e: any) {
      throw new Error(
        `BLE module not available: ${e.message}. Run "npx expo prebuild --clean && npx expo run:android"`,
      );
    }

    // Register event listeners
    this.subscriptions.push(
      BleModule.onWrite((event) => {
        console.log('[BLE] onWrite', event.characteristicUuid);
        const bytes = base64ToBytes(event.value);
        const json = this.defragmenter.push(new Uint8Array(bytes));
        if (json && this._onMessage) {
          try {
            this._onMessage(JSON.parse(json));
          } catch {
            /* ignore malformed JSON */
          }
        }
      }),
    );

    this.subscriptions.push(
      BleModule.onSubscribe((event) => {
        console.log('[BLE] onSubscribe', event.characteristicUuid);
        this.subscribed = true;
        this._onConnected?.();
      }),
    );

    this.subscriptions.push(
      BleModule.onUnsubscribe((event) => {
        console.log('[BLE] onUnsubscribe', event.characteristicUuid);
        this.subscribed = false;
        this._onDisconnected?.();
      }),
    );

    this.subscriptions.push(
      BleModule.onDisconnect((event) => {
        console.log('[BLE] onDisconnect', JSON.stringify(event));
        this.subscribed = false;
        this._onDisconnected?.();
      }),
    );

    // Start GATT server + advertising
    await BleModule.start(
      BLE_SERVICE_UUID,
      BLE_WRITE_CHAR_UUID,
      BLE_NOTIFY_CHAR_UUID,
      'WalletPair',
    );
    this.started = true;
    console.log('[BLE] peripheral started');
  }

  async sendMessage(msg: Record<string, unknown>): Promise<void> {
    if (!this.started || !this.subscribed) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BleModule: typeof import('../../modules/ble-peripheral') =
      require('../../modules/ble-peripheral');

    const frames = frameMessage(JSON.stringify(msg));
    for (const frame of frames) {
      await BleModule.sendNotification(bytesToBase64(frame));
    }
  }

  isConnected(): boolean {
    return this.subscribed;
  }

  async stop(): Promise<void> {
    // Remove event listeners
    for (const sub of this.subscriptions) sub.remove();
    this.subscriptions = [];

    if (this.started) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const BleModule: typeof import('../../modules/ble-peripheral') =
          require('../../modules/ble-peripheral');
        await BleModule.stop();
      } catch {
        /* best effort */
      }
    }
    this.started = false;
    this.subscribed = false;
    this.defragmenter.reset();
  }
}
