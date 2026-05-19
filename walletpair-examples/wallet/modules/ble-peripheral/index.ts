import { NativeModule, requireNativeModule } from 'expo-modules-core';
import { EventEmitter, type Subscription } from 'expo-modules-core';

interface BlePeripheralModuleType extends NativeModule {
  start(serviceUuid: string, writeCharUuid: string, notifyCharUuid: string, deviceName: string): Promise<void>;
  stop(): Promise<void>;
  sendNotification(base64Data: string): Promise<void>;
}

const native = requireNativeModule<BlePeripheralModuleType>('BlePeripheral');
const emitter = new EventEmitter(native);

export interface WriteEvent {
  characteristicUuid: string;
  value: string; // base64
}

export interface SubscribeEvent {
  characteristicUuid: string;
}

export interface ConnectEvent {
  address: string;
}

export function start(
  serviceUuid: string,
  writeCharUuid: string,
  notifyCharUuid: string,
  deviceName: string = 'WalletPair',
): Promise<void> {
  return native.start(serviceUuid, writeCharUuid, notifyCharUuid, deviceName);
}

export function stop(): Promise<void> {
  return native.stop();
}

export function sendNotification(base64Data: string): Promise<void> {
  return native.sendNotification(base64Data);
}

export function onWrite(handler: (event: WriteEvent) => void): Subscription {
  return emitter.addListener('onWrite', handler);
}

export function onSubscribe(handler: (event: SubscribeEvent) => void): Subscription {
  return emitter.addListener('onSubscribe', handler);
}

export function onUnsubscribe(handler: (event: SubscribeEvent) => void): Subscription {
  return emitter.addListener('onUnsubscribe', handler);
}

export function onConnect(handler: (event: ConnectEvent) => void): Subscription {
  return emitter.addListener('onConnect', handler);
}

export function onDisconnect(handler: (event: { address?: string; error?: string }) => void): Subscription {
  return emitter.addListener('onDisconnect', handler);
}
