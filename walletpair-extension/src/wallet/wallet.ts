// A reference Wallet: the Wallet side of spec/core.md, with per-network
// signers that sign for real and prompts supplied by whoever runs it (the
// tests, the CLI wallet, the website's demo wallet). It is not part of the
// extension's bundle.

import type { Transport } from '../lib/walletpair/client';
import { dispose } from '../lib/walletpair/dispatch';
import type { Network } from '../lib/walletpair/networks/types';
import {
  ErrorCode,
  encode,
  parseRequest,
  rpcError,
  type ConnectParams,
  type Json,
  type NamespaceState,
  type Params,
  type Request,
  type Response,
  type RpcError,
  type SessionState,
} from '../lib/walletpair/protocol';

/** Thrown by a signer to answer with an error. */
export class WalletError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export interface PerformContext {
  request: Request;
  state: NamespaceState;
  /** Changes this namespace's active chain; sends the state event (core §4.3). */
  setChain(chain: string): void;
}

/** One network's keys and behaviour. */
export interface Signer {
  network: Network;
  chain: string;
  accounts: string[];
  perform(method: string, params: Params | undefined, context: PerformContext): Promise<Json>;
}

/** The user, scripted by the test. */
export interface Prompts {
  /** Which of the offered namespaces the user approves; none declines. */
  connect(params: ConnectParams, offered: string[], origin?: string): Promise<string[]>;
  /** Whether the user approves a request. */
  approve(request: Request): Promise<boolean>;
}

/** What survives a restart (core §6). */
export interface WalletStore {
  approved: string[];
  chains: Record<string, string>;
  /** Recorded requests: the response, or null while in progress. */
  records: Map<string, Response | null>;
}

export function emptyStore(): WalletStore {
  return { approved: [], chains: {}, records: new Map() };
}

export interface WalletOptions {
  name: string;
  icon?: string;
  signers: Signer[];
  prompts: Prompts;
  store?: WalletStore;
  /** Requests that may wait for the user at once before -32005. */
  maxWaiting?: number;
}

export class ReferenceWallet {
  readonly store: WalletStore;
  /** Every request received, for assertions. */
  readonly received: Request[] = [];

  readonly #transport: Transport;
  readonly #options: WalletOptions;
  readonly #networks: Network[];
  readonly #waiting = new Map<string, () => void>();
  #connectPrompt: Promise<void> | undefined;
  #connectWaiters: Request[] = [];

  constructor(transport: Transport, options: WalletOptions) {
    this.#transport = transport;
    this.#options = options;
    this.#networks = options.signers.map((s) => s.network);
    this.store = options.store ?? emptyStore();
    for (const signer of options.signers) this.store.chains[signer.network.namespace] ??= signer.chain;
    transport.addEventListener('message', (event) => {
      void this.#receive((event as MessageEvent<Uint8Array>).data);
    });
    // A closed room ends the session: forget its approval and records (core §2.4).
    transport.addEventListener('state', () => {
      // Leaving (the app stopping) keeps the session; only a close ends it.
      if (transport.state !== 'closed' || (transport as { reason?: string }).reason === 'left') return;
      for (const cancel of [...this.#waiting.values()]) cancel();
      this.store.approved = [];
      this.store.records.clear();
    });
    // After a restart, queued events may have been lost (core §4.3).
    if (this.store.approved.length) this.#sendState();
  }

  get state(): SessionState {
    const state: SessionState = {};
    for (const namespace of this.store.approved) {
      const signer = this.#signer(namespace);
      if (signer) state[namespace] = { chain: this.store.chains[namespace], accounts: [...signer.accounts] };
    }
    return state;
  }

  /** The user switches chains in the Wallet. */
  setChain(namespace: string, chain: string): void {
    this.store.chains[namespace] = chain;
    if (this.store.approved.includes(namespace)) this.#sendState();
  }

  /** The user revokes the session's approval without ending it. */
  revoke(): void {
    this.store.approved = [];
    this.#sendState();
  }

  /** Ids of requests waiting for the user. */
  get waiting(): string[] {
    return [...this.#waiting.keys()];
  }

  async #receive(bytes: Uint8Array): Promise<void> {
    const inbound = parseRequest(bytes);
    if (inbound.kind === 'ignore') return;
    if (inbound.kind === 'invalid') {
      return this.#send({ id: inbound.id, error: rpcError(ErrorCode.InvalidRequest, 'Invalid request') });
    }
    const { request } = inbound;
    this.received.push(request);
    const records = this.store.records;
    const disposition = dispose(request, { state: this.state, seen: (id) => records.has(id) }, this.#networks);

    switch (disposition.action) {
      case 'repeat': {
        const recorded = records.get(request.id);
        if (recorded) this.#send(recorded);
        return;
      }
      case 'error':
        return this.#send({ id: request.id, error: disposition.error });
      case 'connect':
        return this.#connect(request, disposition.params);
      case 'cancel':
        this.#waiting.get(disposition.id)?.();
        return this.#send({ id: request.id, result: null });
      case 'perform': {
        const { network, fn } = disposition;
        const signer = this.#signer(network.namespace)!;
        if (fn.readOnly) return this.#send(await this.#perform(signer, request));
        if (this.#waiting.size >= (this.#options.maxWaiting ?? 16)) {
          return this.#send({ id: request.id, error: rpcError(ErrorCode.LimitExceeded, 'Too many requests') });
        }
        records.set(request.id, null);
        const approved = await this.#ask(request);
        const response: Response = approved
          ? await this.#perform(signer, request)
          : { id: request.id, error: rpcError(ErrorCode.UserRejected, 'User rejected the request') };
        records.set(request.id, response);
        return this.#send(response);
      }
    }
  }

  async #perform(signer: Signer, request: Request): Promise<Response> {
    const namespace = signer.network.namespace;
    const context: PerformContext = {
      request,
      state: this.state[namespace],
      setChain: (chain) => this.setChain(namespace, chain),
    };
    try {
      return { id: request.id, result: await signer.perform(request.method, request.params, context) };
    } catch (error) {
      const code = error instanceof WalletError ? error.code : ErrorCode.Internal;
      return { id: request.id, error: rpcError(code, (error as Error).message) };
    }
  }

  /** Waits for the user; cancellation (core §5) answers false. */
  #ask(request: Request): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (answer: boolean) => {
        if (done) return;
        done = true;
        this.#waiting.delete(request.id);
        resolve(answer);
      };
      this.#waiting.set(request.id, () => finish(false));
      this.#options.prompts.approve(request).then(finish, () => finish(false));
    });
  }

  async #connect(request: Request, params: ConnectParams): Promise<void> {
    const supported = this.#networks.map((n) => n.namespace);
    const offered = params.namespaces.filter((ns) => supported.includes(ns));
    if (offered.length === 0) {
      return this.#send({ id: request.id, error: rpcError(ErrorCode.Unsupported, 'No requested namespace is supported') });
    }
    const missing = offered.filter((ns) => !this.store.approved.includes(ns));
    if (missing.length === 0) return this.#answerConnect(request);

    // One prompt per session; everyone waiting gets its outcome (core §4.1).
    this.#connectWaiters.push(request);
    this.#connectPrompt ??= (async () => {
      let granted: string[] = [];
      try {
        granted = await this.#options.prompts.connect(params, missing, request.origin);
      } catch {
        // A failed prompt declines.
      }
      for (const ns of granted) if (missing.includes(ns) && !this.store.approved.includes(ns)) this.store.approved.push(ns);
      const waiters = this.#connectWaiters;
      this.#connectWaiters = [];
      this.#connectPrompt = undefined;
      for (const waiter of waiters) this.#answerConnect(waiter);
    })();
  }

  #answerConnect(request: Request): void {
    const state = this.state;
    if (Object.keys(state).length === 0) {
      return this.#send({ id: request.id, error: rpcError(ErrorCode.UserRejected, 'User rejected the request') });
    }
    const wallet: { name: string; icon?: string } = { name: this.#options.name };
    if (this.#options.icon) wallet.icon = this.#options.icon;
    this.#send({ id: request.id, result: { wallet, state } as unknown as Json });
  }

  #sendState(): void {
    this.#send({ event: 'state', data: this.state as unknown as Json });
  }

  #signer(namespace: string): Signer | undefined {
    return this.#options.signers.find((s) => s.network.namespace === namespace);
  }

  #send(message: Response | { event: string; data: Json }): void {
    try {
      this.#transport.send(encode(message));
    } catch {
      // The room has closed.
    }
  }
}

export type { RpcError };
