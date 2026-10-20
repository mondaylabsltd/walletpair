// The page providers' link to the extension: calls go out with window
// messages to the content script, results and the site's state come back.

import { MSG_CHANNEL } from '../constants';
import type { PageCall, PageMessage, PageMessageBody, SiteState } from '../types';
import type { RpcError } from '../walletpair/protocol';

export class ProviderRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'ProviderRpcError';
    this.code = code;
    this.data = data;
  }
}

export interface Bridge {
  /** What this site may see, as last reported by the extension. */
  readonly state: SiteState;
  /** Whether a WalletPair session exists. */
  readonly live: boolean;
  call<T = unknown>(call: PageCall): Promise<T>;
  /** Runs `listener` with the previous state whenever the state or `live` changes. */
  subscribe(listener: (previous: SiteState, wasLive: boolean) => void): void;
  /** Called synchronously inside a click handler: lets the extension open its panel. */
  gesture(): void;
}

export function createBridge(target: Window = window): Bridge {
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: ProviderRpcError): void }>();
  const listeners: ((previous: SiteState, wasLive: boolean) => void)[] = [];
  let state: SiteState = {};
  let live = false;

  // Messages stay in this window, the page's own; '*' also works on opaque origins.
  const post = (message: PageMessageBody) => target.postMessage({ ...message, channel: MSG_CHANNEL }, '*');

  target.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== target || event.data?.channel !== MSG_CHANNEL) return;
    const message = event.data as PageMessage;
    if (message.type === 'result') {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) {
        const error = message.error as RpcError;
        waiter.reject(new ProviderRpcError(error.code, error.message, error.data));
      } else {
        waiter.resolve(message.result);
      }
    } else if (message.type === 'state') {
      const previous = state;
      const wasLive = live;
      state = message.state;
      live = message.live;
      for (const listener of listeners) {
        try {
          listener(previous, wasLive);
        } catch {
          // A provider's listener must not stop the others.
        }
      }
    }
  });

  // The content script may start before or after this script; whichever
  // comes second gets the state from the other's greeting.
  post({ type: 'hello' });

  return {
    get state() {
      return state;
    },
    get live() {
      return live;
    },
    call<T>(call: PageCall): Promise<T> {
      const id = crypto.randomUUID();
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        post({ type: 'call', id, call });
      });
    },
    subscribe(listener) {
      listeners.push(listener);
    },
    gesture() {
      target.dispatchEvent(new CustomEvent('walletpair:open-panel'));
    },
  };
}
