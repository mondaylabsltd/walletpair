/**
 * ISOLATED world content script - bridges between:
 *   - MAIN world provider (window.postMessage)
 *   - Background service worker (chrome.runtime)
 */
import { MSG_CHANNEL } from '@/lib/constants';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',

  main() {
    const origin = window.location.origin;

    // Use a persistent port connection for faster messaging
    let port: chrome.runtime.Port | null = null;
    const pendingFromPage = new Map<string, boolean>();

    function getPort(): chrome.runtime.Port {
      if (!port) {
        port = chrome.runtime.connect({ name: 'walletpair-content' });
        port.onMessage.addListener(handleBackgroundMessage);
        port.onDisconnect.addListener(() => {
          port = null;
        });
      }
      return port;
    }

    // Forward RPC requests from page -> background
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.data?.channel !== MSG_CHANNEL) return;

      const msg = event.data;

      if (msg.type === 'wp-request') {
        pendingFromPage.set(msg.id, true);
        try {
          getPort().postMessage({
            action: 'rpc-request',
            id: msg.id,
            payload: msg.payload,
            origin,
          });
        } catch {
          // Port disconnected, try sendMessage as fallback
          chrome.runtime.sendMessage({
            action: 'rpc-request',
            id: msg.id,
            payload: msg.payload,
            origin,
          }).then((response) => {
            if (response) {
              handleBackgroundMessage(response);
            }
          }).catch(() => {
            // Send error back to page
            window.postMessage(
              {
                type: 'wp-response',
                id: msg.id,
                error: { code: -32603, message: 'Extension not available' },
                channel: MSG_CHANNEL,
              },
              '*',
            );
          });
        }
      }
    });

    // Forward responses and events from background -> page
    function handleBackgroundMessage(msg: any) {
      if (msg.action === 'rpc-response') {
        window.postMessage(
          {
            type: 'wp-response',
            id: msg.id,
            result: msg.result,
            error: msg.error,
            method: msg.method,
            channel: MSG_CHANNEL,
          },
          '*',
        );
        pendingFromPage.delete(msg.id);
      }

      if (msg.action === 'emit-event') {
        window.postMessage(
          {
            type: 'wp-event',
            event: msg.event,
            data: msg.data,
            channel: MSG_CHANNEL,
          },
          '*',
        );
      }
    }

    // Also listen for broadcast messages from background
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'emit-event') {
        handleBackgroundMessage(msg);
      }
    });
  },
});
