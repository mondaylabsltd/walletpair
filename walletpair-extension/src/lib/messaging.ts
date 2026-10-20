import { browser } from 'wxt/browser';
import type { ExtensionState, UiMessage } from './types';

/** Sends a side panel action to the background; resolves with the new state. */
export function sendToBackground(message: UiMessage): Promise<ExtensionState> {
  return browser.runtime.sendMessage(message);
}

export function getExtensionState(): Promise<ExtensionState> {
  return sendToBackground({ action: 'get-state' });
}

/**
 * Calls back with the current state, then on every change, through a port
 * (which also reaches the background after it restarts). Returns an
 * unsubscribe function.
 */
export function onStateUpdate(callback: (state: ExtensionState) => void): () => void {
  let stopped = false;
  let port: ReturnType<typeof browser.runtime.connect> | undefined;
  const open = () => {
    if (stopped) return;
    port = browser.runtime.connect({ name: 'walletpair-ui' });
    port.onMessage.addListener((message: { state?: ExtensionState }) => {
      if (message.state) callback(message.state);
    });
    port.onDisconnect.addListener(() => setTimeout(open, 250));
  };
  open();
  return () => {
    stopped = true;
    port?.disconnect();
  };
}
