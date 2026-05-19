import type { BackgroundMessage, ExtensionState } from './types';

/**
 * Send a message to the background service worker and get a typed response.
 */
export async function sendToBackground<T = unknown>(message: BackgroundMessage): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

/**
 * Get current extension state from background.
 */
export async function getExtensionState(): Promise<ExtensionState> {
  return sendToBackground<ExtensionState>({ action: 'get-state' });
}

/**
 * Listen for state updates from background (via chrome.runtime.onMessage).
 * Returns an unsubscribe function.
 */
export function onStateUpdate(callback: (state: ExtensionState) => void): () => void {
  const handler = (message: { action: string; state: ExtensionState }) => {
    if (message.action === 'state-update') {
      callback(message.state);
    }
  };
  chrome.runtime.onMessage.addListener(handler);
  return () => chrome.runtime.onMessage.removeListener(handler);
}
