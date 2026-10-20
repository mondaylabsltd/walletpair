import type { ExtensionState, UiMessage } from './types';

/** Sends a side panel action to the background; resolves with the new state. */
export function sendToBackground(message: UiMessage): Promise<ExtensionState> {
  return chrome.runtime.sendMessage(message);
}

export function getExtensionState(): Promise<ExtensionState> {
  return sendToBackground({ action: 'get-state' });
}

/** Calls back on every state the background broadcasts; returns an unsubscribe function. */
export function onStateUpdate(callback: (state: ExtensionState) => void): () => void {
  const handler = (message: { action?: string; state?: ExtensionState }) => {
    if (message.action === 'state-update' && message.state) callback(message.state);
  };
  chrome.runtime.onMessage.addListener(handler);
  return () => chrome.runtime.onMessage.removeListener(handler);
}
