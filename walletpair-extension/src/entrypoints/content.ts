/**
 * Runs beside the page (ISOLATED world) and relays between the page providers
 * (window messages) and the background (a runtime port). The background learns
 * the page's origin from the port, never from the page.
 */
import { MSG_CHANNEL } from '@/lib/constants';
import type { BackgroundMessage, ContentMessage, PageMessage, PageMessageBody } from '@/lib/types';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',

  main() {
    const toPage = (message: PageMessageBody) => window.postMessage({ ...message, channel: MSG_CHANNEL }, '*');
    const fail = (id: string, code: number, message: string) => toPage({ type: 'result', id, error: { code, message } });

    // WalletPair serves web pages only.
    const web = location.protocol === 'https:' || location.protocol === 'http:';

    let port: chrome.runtime.Port | null = null;
    let gone = false;
    /** Calls sent to the background and not yet answered. */
    const inFlight = new Set<string>();

    function connect(): chrome.runtime.Port | null {
      if (port || gone) return port;
      try {
        port = chrome.runtime.connect({ name: 'walletpair-content' });
      } catch {
        // The extension was updated or removed; this page must be reloaded.
        gone = true;
        return null;
      }
      port.onMessage.addListener((message: BackgroundMessage) => {
        if (message.kind === 'result') {
          inFlight.delete(message.id);
          toPage({ type: 'result', id: message.id, result: message.result, error: message.error });
        } else {
          toPage({ type: 'state', state: message.state, live: message.live });
        }
      });
      port.onDisconnect.addListener(() => {
        port = null;
        // The background restarted; it cancels what it had sent the Wallet.
        for (const id of inFlight) fail(id, 4900, 'WalletPair restarted, please try again');
        inFlight.clear();
        if (!chrome.runtime?.id) gone = true;
        else setTimeout(() => send({ kind: 'hello' }), 250);
      });
      return port;
    }

    function send(message: ContentMessage): boolean {
      const current = connect();
      if (!current) return false;
      try {
        current.postMessage(message);
        return true;
      } catch {
        port = null;
        return false;
      }
    }

    window.addEventListener('message', (event) => {
      if (event.source !== window || event.data?.channel !== MSG_CHANNEL) return;
      const message = event.data as PageMessage;
      if (message.type === 'hello') {
        if (web) send({ kind: 'hello' });
      } else if (message.type === 'call') {
        if (!web) return fail(message.id, 4900, 'WalletPair works on web pages only');
        inFlight.add(message.id);
        if (!send({ kind: 'call', id: message.id, call: message.call })) {
          inFlight.delete(message.id);
          fail(message.id, 4900, 'WalletPair is unavailable; reload the page');
        }
      }
    });

    // Sent synchronously from a page's click, so the background may open its panel.
    window.addEventListener('walletpair:open-panel', () => {
      chrome.runtime.sendMessage({ action: 'open-panel' }).catch(() => {});
    });

    // The page script may have greeted before this script was listening.
    if (web) send({ kind: 'hello' });
  },
});
