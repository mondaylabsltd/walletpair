// The DApp side of a WalletPair session over a PeerConnect connection:
// calls, walletpair_connect, the state event, cancellation, and resending
// after a break (spec/core.md §4–§6).

import {
  ErrorCode,
  encode,
  parseConnectResult,
  parseFromWallet,
  parseState,
  rpcError,
  type ConnectResult,
  type Json,
  type NamespaceRules,
  type Params,
  type Request,
  type RpcError,
  type SessionState,
  type WalletInfo,
} from './protocol';

/** What the client needs from a PeerConnect `Connection`. */
export interface Transport extends EventTarget {
  readonly state: 'offline' | 'waiting' | 'connected' | 'closed';
  send(data: Uint8Array): number;
}

export class CallError extends Error {
  readonly code: number;
  readonly data?: Json;

  constructor(error: RpcError) {
    super(error.message);
    this.name = 'CallError';
    this.code = error.code;
    this.data = error.data;
  }
}

export interface DAppInfo {
  name: string;
  url?: string;
  icon?: string;
}

interface Pending {
  request: Request;
  resolve(result: Json): void;
  reject(error: CallError): void;
}

/**
 * Events: `state` (session state or wallet changed), `pending` (the set of
 * pending request ids changed; persist it to cancel them after a restart),
 * `ended` (the room closed).
 */
export class WalletPairClient extends EventTarget {
  /** The session state; `{}` until approved (core §4.2). */
  state: SessionState = {};
  wallet: WalletInfo | undefined;
  ended = false;

  readonly #transport: Transport;
  readonly #rules: Record<string, NamespaceRules>;
  readonly #pending = new Map<string, Pending>();
  #wasConnected = false;
  #connected = false;

  constructor(transport: Transport, rules: Record<string, NamespaceRules>) {
    super();
    this.#transport = transport;
    this.#rules = rules;
    transport.addEventListener('message', (event) => this.#receive((event as MessageEvent<Uint8Array>).data));
    transport.addEventListener('state', () => this.#transportState());
    this.#transportState();
  }

  get approved(): boolean {
    return Object.keys(this.state).length > 0;
  }

  /** Ids of pending network calls: what to cancel after a restart (core §5). */
  get pendingIds(): string[] {
    return [...this.#pending.values()]
      .filter(({ request }) => !request.method.startsWith('walletpair_'))
      .map(({ request }) => request.id);
  }

  /** Asks for the namespaces; resolves with the Wallet's current state (core §4.1). */
  async connect(dapp: DAppInfo, namespaces: string[], origin?: string): Promise<ConnectResult> {
    const raw = await this.call('walletpair_connect', [{ ...dapp, namespaces }], origin);
    const result = parseConnectResult(raw, this.#rules);
    if (!result) throw new CallError(rpcError(ErrorCode.Internal, 'Invalid walletpair_connect result'));
    this.wallet = result.wallet;
    this.#setState(result.state);
    return result;
  }

  /** Calls a function on the Wallet. Rejects with a CallError carrying its code. */
  call(method: string, params?: Params, origin?: string): Promise<Json> {
    return this.start(method, params, origin).result;
  }

  /** Like `call`, but also returns the request id, for `cancel`. */
  start(method: string, params?: Params, origin?: string): { id: string; result: Promise<Json> } {
    const request: Request = { id: crypto.randomUUID(), method };
    if (params !== undefined) request.params = params;
    if (origin !== undefined) request.origin = origin;
    const result = new Promise<Json>((resolve, reject) => {
      if (this.ended) {
        reject(new CallError(rpcError(ErrorCode.Disconnected, 'Session ended')));
        return;
      }
      try {
        this.#transport.send(encode(request));
      } catch (error) {
        reject(new CallError(rpcError(ErrorCode.Internal, `Cannot send: ${(error as Error).message}`)));
        return;
      }
      this.#pending.set(request.id, { request, resolve, reject });
      this.dispatchEvent(new Event('pending'));
    });
    return { id: request.id, result };
  }

  /**
   * Withdraws pending calls (core §5): each is answered locally with 4001, and
   * the Wallet is told so it removes its prompt. Also accepts ids from before
   * a restart, which are no longer pending here.
   */
  cancel(ids: string[]): void {
    for (const id of ids) {
      const pending = this.#pending.get(id);
      if (pending) {
        this.#pending.delete(id);
        pending.reject(new CallError(rpcError(ErrorCode.UserRejected, 'Request cancelled')));
      }
      if (!this.ended) this.call('walletpair_cancel', [id]).catch(() => {});
    }
    this.dispatchEvent(new Event('pending'));
  }

  /** Ids of pending calls whose request matches. */
  find(match: (request: Request) => boolean): string[] {
    return [...this.#pending.values()].filter((p) => match(p.request)).map((p) => p.request.id);
  }

  #receive(bytes: Uint8Array): void {
    const message = parseFromWallet(bytes);
    if (message.kind === 'response') {
      const { response } = message;
      const pending = this.#pending.get(response.id);
      if (!pending) return;
      this.#pending.delete(response.id);
      this.dispatchEvent(new Event('pending'));
      if ('error' in response) pending.reject(new CallError(response.error));
      else pending.resolve(response.result);
    } else if (message.kind === 'event' && message.event.event === 'state') {
      const state = parseState(message.event.data, this.#rules);
      if (state) this.#setState(state);
    }
  }

  #setState(state: SessionState): void {
    this.state = state;
    this.dispatchEvent(new Event('state'));
  }

  #transportState(): void {
    const state = this.#transport.state;
    if (state === 'closed') {
      this.#end();
      return;
    }
    const connected = state === 'connected';
    if (connected && !this.#connected) {
      // Back after a break: the Wallet may have restarted and lost responses (core §6).
      if (this.#wasConnected) {
        for (const { request } of this.#pending.values()) {
          try {
            this.#transport.send(encode(request));
          } catch {
            // The room is closing; #end will answer everything.
          }
        }
      }
      this.#wasConnected = true;
    }
    this.#connected = connected;
  }

  #end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const pending of this.#pending.values()) {
      pending.reject(new CallError(rpcError(ErrorCode.Disconnected, 'Session ended')));
    }
    this.#pending.clear();
    this.dispatchEvent(new Event('pending'));
    this.dispatchEvent(new Event('ended'));
  }
}
