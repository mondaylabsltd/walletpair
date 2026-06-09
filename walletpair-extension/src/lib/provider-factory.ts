/**
 * EIP-1193 provider factory.
 *
 * Extracted from provider.content.ts so the core logic can be tested
 * without requiring the browser extension content script environment.
 */

const MSG_CHANNEL = 'walletpair-ext';
const PROVIDER_UUID = 'e3a10000-7770-4270-8000-000077700001';

export class ProviderRpcError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
    this.name = 'ProviderRpcError';
  }
}

export const UNSUPPORTED_METHODS = new Set([
  'eth_getEncryptionPublicKey',
  'eth_decrypt',
  'eth_sign',
  'wallet_addEthereumChain',
]);

export interface PostMessageFn {
  (message: any, targetOrigin: string): void;
}

export interface ProviderState {
  accounts: string[];
  chainId: string;
  isConnected: boolean;
}

/**
 * Create a WalletPair EIP-1193 provider.
 *
 * @param postMessage - function used to send messages to the content bridge
 *                      (defaults to window.postMessage)
 */
export function createProvider(postMessage: PostMessageFn) {
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let reqCounter = 0;
  const eventListeners = new Map<string, Set<(...args: any[]) => void>>();

  const state: ProviderState = {
    accounts: [],
    chainId: '0x1',
    isConnected: false,
  };

  function emit(event: string, ...args: any[]) {
    eventListeners.get(event)?.forEach((handler) => {
      try { handler(...args); } catch {}
    });
  }

  const provider: Record<string, any> = {
    isWalletPair: true,

    async request(args: { method: string; params?: unknown }): Promise<unknown> {
      const { method, params } = args;

      if (UNSUPPORTED_METHODS.has(method)) {
        throw new ProviderRpcError(4200, `${method} is not supported`);
      }

      if (method === 'eth_accounts') {
        return state.isConnected ? [...state.accounts] : [];
      }
      if (method === 'eth_chainId') {
        return state.chainId;
      }
      if (method === 'net_version') {
        return String(parseInt(state.chainId, 16));
      }
      if (method === 'web3_clientVersion') {
        return 'WalletPair/0.1.0';
      }

      const id = `wp-${++reqCounter}-${Date.now()}`;
      return new Promise((resolve, reject) => {
        // Fix #3: Store timer handle so we can clear it when response arrives
        const timer = setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new ProviderRpcError(-32603, 'Request timed out'));
          }
        }, 60_000);

        pending.set(id, { resolve, reject, timer });
        postMessage(
          { type: 'wp-request', id, payload: { method, params }, channel: MSG_CHANNEL },
          '*',
        );
      });
    },

    on(event: string, handler: (...args: any[]) => void) {
      if (!eventListeners.has(event)) eventListeners.set(event, new Set());
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

    once(event: string, handler: (...args: any[]) => void) {
      const wrapped = (...args: any[]) => {
        provider.removeListener(event, wrapped);
        handler(...args);
      };
      return provider.on(event, wrapped);
    },

    listenerCount(event: string) {
      return eventListeners.get(event)?.size ?? 0;
    },

    removeAllListeners(event?: string) {
      if (event) {
        eventListeners.delete(event);
      } else {
        eventListeners.clear();
      }
      return provider;
    },

    enable() {
      return provider.request({ method: 'eth_requestAccounts' });
    },

    send(methodOrPayload: string | { method: string; params?: unknown[]; id?: number }, callbackOrParams?: unknown) {
      if (typeof methodOrPayload === 'string') {
        const syncMethods: Record<string, () => unknown> = {
          eth_accounts: () => state.isConnected ? [...state.accounts] : [],
          eth_chainId: () => state.chainId,
          net_version: () => String(parseInt(state.chainId, 16)),
          web3_clientVersion: () => 'WalletPair/0.1.0',
        };
        if (methodOrPayload in syncMethods) {
          return {
            id: ++reqCounter,
            jsonrpc: '2.0' as const,
            result: syncMethods[methodOrPayload](),
          };
        }
        return provider.request({ method: methodOrPayload, params: callbackOrParams as unknown[] });
      }
      // Fix #12: Use request id from payload, or generate a unique one
      const rpcId = methodOrPayload.id ?? ++reqCounter;
      if (typeof callbackOrParams === 'function') {
        provider
          .request({ method: methodOrPayload.method, params: methodOrPayload.params })
          .then((result: unknown) =>
            (callbackOrParams as Function)(null, { id: rpcId, jsonrpc: '2.0', result }),
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
      const rpcId = payload.id ?? ++reqCounter;
      provider
        .request({ method: payload.method, params: payload.params })
        .then((result: unknown) => callback(null, { id: rpcId, jsonrpc: '2.0', result }))
        .catch((err: Error) => callback(err));
    },

    isConnected() {
      return state.isConnected;
    },

    _metamask: {
      isUnlocked: () => Promise.resolve(state.isConnected),
    },

    selectedAddress: null as string | null,
    chainId: state.chainId,
    networkVersion: '1',
  };

  /**
   * Handle incoming messages from the content bridge.
   * Call this from a window 'message' event listener.
   */
  function handleMessage(msg: any) {
    if (msg.channel !== MSG_CHANNEL) return;

    if (msg.type === 'wp-response') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer); // Fix #3: prevent leaked timeout

      if (msg.error) {
        p.reject(new ProviderRpcError(
          msg.error.code ?? -32603,
          msg.error.message ?? 'Internal error',
          msg.error.data,
        ));
      } else {
        if (msg.method === 'eth_requestAccounts' || msg.method === 'wallet_getAccounts') {
          if (Array.isArray(msg.result) && msg.result.length > 0) {
            state.accounts = msg.result;
            provider.selectedAddress = state.accounts[0];
            if (!state.isConnected) {
              state.isConnected = true;
              emit('connect', { chainId: state.chainId });
            }
            emit('accountsChanged', state.accounts);
          }
        }
        p.resolve(msg.result);
      }
    }

    if (msg.type === 'wp-event') {
      const { event: evtName, data } = msg;
      if (evtName === 'accountsChanged' && Array.isArray(data)) {
        state.accounts = data;
        provider.selectedAddress = state.accounts[0] ?? null;
        emit('accountsChanged', state.accounts);
      } else if (evtName === 'chainChanged') {
        state.chainId = typeof data === 'string' ? data : `0x${Number(data).toString(16)}`;
        provider.chainId = state.chainId;
        provider.networkVersion = String(parseInt(state.chainId, 16));
        emit('chainChanged', state.chainId);
      } else if (evtName === 'disconnect') {
        state.isConnected = false;
        state.accounts = [];
        provider.selectedAddress = null;
        emit('disconnect', new ProviderRpcError(4900, 'Disconnected'));
      } else if (evtName === 'connect') {
        if (!state.isConnected) {
          state.isConnected = true;
          emit('connect', { chainId: state.chainId });
        }
      } else if (evtName === 'message') {
        emit('message', data);
      }
    }

    if (msg.type === 'wp-init-state') {
      const { connected, accounts: initAccounts, chainId: initChainId } = msg;
      if (connected && Array.isArray(initAccounts) && initAccounts.length > 0) {
        state.accounts = initAccounts;
        state.chainId = initChainId || state.chainId;
        provider.selectedAddress = state.accounts[0];
        provider.chainId = state.chainId;
        provider.networkVersion = String(parseInt(state.chainId, 16));
        if (!state.isConnected) {
          state.isConnected = true;
          emit('connect', { chainId: state.chainId });
        }
      }
    }
  }

  return { provider, handleMessage, pending, state };
}

export const PROVIDER_ICON =
  'data:image/png;base64,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';

export const PROVIDER_INFO = Object.freeze({
  uuid: PROVIDER_UUID,
  name: 'WalletPair',
  icon: PROVIDER_ICON,
  rdns: 'org.walletpair.extension',
});
