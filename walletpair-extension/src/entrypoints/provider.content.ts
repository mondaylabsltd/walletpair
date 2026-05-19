/**
 * MAIN world content script - injects EIP-1193 provider + EIP-6963 into the page.
 * Also injects as window.ethereum for legacy dApps.
 *
 * This runs in the page's JS context, NOT the extension's isolated world.
 * Communication with extension is via window.postMessage only.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    const MSG_CHANNEL = 'walletpair-ext';
    const PROVIDER_UUID = 'e3a10000-7770-4270-8000-000077700001';

    // Pending RPC requests waiting for responses
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    let reqCounter = 0;

    // Event listeners for EIP-1193 events
    const eventListeners = new Map<string, Set<(...args: any[]) => void>>();

    // Cached state
    let accounts: string[] = [];
    let chainId = '0x1';
    let isConnected = false;

    // --- EIP-1193 Provider ---
    const provider: Record<string, any> = {
      isWalletPair: true,

      async request(args: { method: string; params?: unknown }): Promise<unknown> {
        const { method, params } = args;

        // Local fast-path for cached data
        if (method === 'eth_accounts') {
          return isConnected ? [...accounts] : [];
        }
        if (method === 'eth_chainId') {
          return chainId;
        }
        if (method === 'net_version') {
          return String(parseInt(chainId, 16));
        }

        // Forward to background via content script bridge
        const id = `wp-${++reqCounter}-${Date.now()}`;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          window.postMessage(
            { type: 'wp-request', id, payload: { method, params }, channel: MSG_CHANNEL },
            '*',
          );

          // Timeout after 5 minutes (signing can take time)
          setTimeout(() => {
            if (pending.has(id)) {
              pending.delete(id);
              reject(new Error('Request timeout'));
            }
          }, 300_000);
        });
      },

      on(event: string, handler: (...args: any[]) => void) {
        if (!eventListeners.has(event)) {
          eventListeners.set(event, new Set());
        }
        eventListeners.get(event)!.add(handler);
        return provider;
      },

      addListener(event: string, handler: (...args: any[]) => void) {
        return provider.on(event, handler);
      },

      removeListener(event: string, handler: (...args: any[]) => void) {
        eventListeners.get(event)?.delete(handler);
        return provider;
      },

      removeAllListeners(event?: string) {
        if (event) {
          eventListeners.delete(event);
        } else {
          eventListeners.clear();
        }
        return provider;
      },

      emit(event: string, ...args: any[]) {
        eventListeners.get(event)?.forEach((handler) => {
          try {
            handler(...args);
          } catch {}
        });
      },

      // Legacy methods some dApps still use
      enable() {
        return provider.request({ method: 'eth_requestAccounts' });
      },

      send(methodOrPayload: string | { method: string; params?: unknown[] }, callbackOrParams?: unknown) {
        // Handle both send(method, params) and send(payload, callback) signatures
        if (typeof methodOrPayload === 'string') {
          return provider.request({ method: methodOrPayload, params: callbackOrParams as unknown[] });
        }
        // send({ method, params }, callback) - legacy
        if (typeof callbackOrParams === 'function') {
          provider
            .request({ method: methodOrPayload.method, params: methodOrPayload.params })
            .then((result: unknown) =>
              (callbackOrParams as Function)(null, { id: 1, jsonrpc: '2.0', result }),
            )
            .catch((err: Error) => (callbackOrParams as Function)(err));
          return;
        }
        return provider.request({ method: methodOrPayload.method, params: methodOrPayload.params });
      },

      sendAsync(
        payload: { method: string; params?: unknown[]; id?: number },
        callback: (err: Error | null, result?: unknown) => void,
      ) {
        provider
          .request({ method: payload.method, params: payload.params })
          .then((result: unknown) => callback(null, { id: payload.id, jsonrpc: '2.0', result }))
          .catch((err: Error) => callback(err));
      },

      isConnected() {
        return isConnected;
      },

      // Some dApps also check these
      selectedAddress: null as string | null,
      chainId,
      networkVersion: '1',
    };

    // --- Listen for responses and events from content script bridge ---
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.data?.channel !== MSG_CHANNEL) return;

      const msg = event.data;

      if (msg.type === 'wp-response') {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);

        if (msg.error) {
          const err = new Error(msg.error.message) as any;
          err.code = msg.error.code;
          p.reject(err);
        } else {
          // Update cached state from responses
          if (msg.method === 'eth_requestAccounts' || msg.method === 'wallet_getAccounts') {
            if (Array.isArray(msg.result) && msg.result.length > 0) {
              accounts = msg.result;
              isConnected = true;
              provider.selectedAddress = accounts[0];
              provider.emit('connect', { chainId });
              provider.emit('accountsChanged', accounts);
            }
          }
          p.resolve(msg.result);
        }
      }

      if (msg.type === 'wp-event') {
        const { event: evtName, data } = msg;
        if (evtName === 'accountsChanged' && Array.isArray(data)) {
          accounts = data;
          provider.selectedAddress = accounts[0] ?? null;
          provider.emit('accountsChanged', accounts);
        } else if (evtName === 'chainChanged') {
          chainId = typeof data === 'string' ? data : `0x${Number(data).toString(16)}`;
          provider.chainId = chainId;
          provider.networkVersion = String(parseInt(chainId, 16));
          provider.emit('chainChanged', chainId);
        } else if (evtName === 'disconnect') {
          isConnected = false;
          accounts = [];
          provider.selectedAddress = null;
          provider.emit('disconnect', { code: 4900, message: 'Disconnected' });
        } else if (evtName === 'connect') {
          isConnected = true;
          provider.emit('connect', { chainId });
        }
      }
    });

    // --- EIP-6963: Announce provider ---
    const icon =
      'data:image/svg+xml,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#6366f1"/><path d="M18 32 L32 18 L46 32 L32 46Z" fill="white" opacity="0.9"/><circle cx="32" cy="32" r="6" fill="#6366f1"/></svg>`,
      );

    const info = Object.freeze({
      uuid: PROVIDER_UUID,
      name: 'WalletPair',
      icon,
      rdns: 'org.walletpair.extension',
    });

    const detail = Object.freeze({ info, provider });

    function announceProvider() {
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', { detail }),
      );
    }

    // Announce on load and on request
    window.addEventListener('eip6963:requestProvider', announceProvider);
    announceProvider();

    // --- window.ethereum injection (legacy support) ---
    // Many dApps check window.ethereum directly. We need to support this.
    const existingProvider = (window as any).ethereum;

    if (!existingProvider) {
      // No other wallet - we claim window.ethereum
      Object.defineProperty(window, 'ethereum', {
        value: provider,
        writable: false,
        configurable: true,
      });
    } else {
      // Another wallet already exists - use the providers array pattern
      // This is the standard multi-wallet coexistence approach
      if (!existingProvider.providers) {
        (existingProvider as any).providers = [existingProvider];
      }
      (existingProvider as any).providers.push(provider);
    }

    // Always set window.walletpair for direct access
    Object.defineProperty(window, 'walletpair', {
      value: provider,
      writable: false,
      configurable: false,
    });

    // Notify content script bridge that provider is ready
    window.postMessage({ type: 'wp-provider-ready', channel: MSG_CHANNEL }, '*');
  },
});
