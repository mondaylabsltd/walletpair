// Answers page providers: per-site approval for each namespace, local
// answers, EVM node reads, and Wallet functions forwarded over the session.

import { READ_ONLY_METHODS } from '../evm/read-methods';
import type { Sites } from '../storage';
import type { ActivityEntry, PageCall, PendingCall, SiteApproval, SiteState } from '../types';
import { CallError } from '../walletpair/client';
import { networkOf } from '../walletpair/dispatch';
import { networkList, namespaceRules } from '../walletpair/networks';
import { ErrorCode, rpcError, type NamespaceState, type Params } from '../walletpair/protocol';
import type { SessionManager } from './session';

export interface RouterDeps {
  session: SessionManager;
  sites: {
    getSites(): Promise<Sites>;
    grantSite(origin: string, namespace: string): Promise<void>;
    revokeSite(origin: string, namespace?: string): Promise<void>;
  };
  activity: {
    add(entry: ActivityEntry): Promise<void>;
    update(id: string, change: Partial<ActivityEntry>): Promise<void>;
  };
  /** A read-only EVM node method on a chain (`eip155:…`). */
  rpc(chain: string, method: string, params: unknown): Promise<unknown>;
  /** Brings up the extension's UI: pairing, or a site waiting for approval. */
  surface(): void;
}

const fail = (code: number, message: string): CallError => new CallError(rpcError(code, message));

interface Approval extends SiteApproval {
  tabId?: number;
  waiters: ((allow: boolean) => void)[];
}

/** Events: `change` (approvals or pending calls), `sites` (what sites can see changed). */
export class Router extends EventTarget {
  readonly #deps: RouterDeps;
  readonly #approvals = new Map<string, Approval>();
  readonly #pending = new Map<string, PendingCall & { tabId?: number }>();

  constructor(deps: RouterDeps) {
    super();
    this.#deps = deps;
  }

  get approvals(): SiteApproval[] {
    return [...this.#approvals.values()].map(({ id, origin, namespace }) => ({ id, origin, namespace }));
  }

  get pending(): PendingCall[] {
    return [...this.#pending.values()].map(({ id, method, origin }) => ({ id, method, origin }));
  }

  /** Whether there is a session, so EVM providers know when to emit `disconnect`. */
  get live(): boolean {
    return this.#deps.session.phase !== 'idle';
  }

  /** The namespaces a site was granted, with the session's chain and accounts. */
  async siteState(origin: string): Promise<SiteState> {
    const granted = (await this.#deps.sites.getSites())[origin] ?? [];
    const state: SiteState = {};
    for (const [namespace, value] of Object.entries(this.#deps.session.state)) {
      if (granted.includes(namespace)) state[namespace] = value;
    }
    return state;
  }

  handle(call: PageCall, origin: string, tabId?: number): Promise<unknown> {
    switch (call.op) {
      case 'connect':
        return this.#connect(call.namespace, call.silent === true, origin, tabId);
      case 'call':
        return this.#call(call.method, call.params, origin, tabId);
      case 'rpc':
        return this.#rpc(call.method, call.params);
      case 'disconnect':
        return this.#disconnect(call.namespace, origin);
      default:
        return Promise.reject(fail(ErrorCode.InvalidRequest, 'Unknown call'));
    }
  }

  /** The user answers a site approval in the side panel. */
  approve(id: string, allow: boolean): void {
    const approval = this.#approvals.get(id);
    if (!approval) return;
    this.#approvals.delete(id);
    for (const waiter of approval.waiters) waiter(allow);
    this.#changed();
  }

  /** The user removes a site in the side panel. */
  async revokeSite(origin: string): Promise<void> {
    await this.#deps.sites.revokeSite(origin);
    this.dispatchEvent(new Event('sites'));
  }

  /** A tab closed or navigated away: its calls and approvals no longer matter (core §5). */
  closeTab(tabId: number): void {
    const ids = [...this.#pending.values()].filter((p) => p.tabId === tabId).map((p) => p.id);
    if (ids.length) this.#deps.session.client?.cancel(ids);
    for (const approval of [...this.#approvals.values()]) {
      if (approval.tabId === tabId) this.approve(approval.id, false);
    }
  }

  async #connect(namespace: string, silent: boolean, origin: string, tabId?: number): Promise<NamespaceState | null> {
    if (!namespaceRules[namespace]) throw fail(ErrorCode.Unsupported, 'Unsupported namespace');
    const { session } = this.#deps;
    const granted = ((await this.#deps.sites.getSites())[origin] ?? []).includes(namespace);
    if (granted && session.state[namespace]) return session.state[namespace];
    if (silent) return null;

    this.#deps.surface();
    if (session.phase === 'idle') await session.pair(origin);
    let shownToUser = false;
    if (!session.state[namespace]) {
      // The Wallet asks the user, showing this site's origin.
      const asked = await session.ask([namespace], origin);
      shownToUser = asked.origin === origin;
    }
    const state = session.state[namespace];
    if (!state) throw fail(ErrorCode.UserRejected, 'Not approved in the wallet');
    if (!granted && !shownToUser && !(await this.#askUser(origin, namespace, tabId))) {
      throw fail(ErrorCode.UserRejected, 'User rejected the request');
    }
    await this.#deps.sites.grantSite(origin, namespace);
    this.dispatchEvent(new Event('sites'));
    return session.state[namespace] ?? state;
  }

  #askUser(origin: string, namespace: string, tabId?: number): Promise<boolean> {
    const existing = [...this.#approvals.values()].find((a) => a.origin === origin && a.namespace === namespace);
    return new Promise((resolve) => {
      if (existing) {
        existing.waiters.push(resolve);
        return;
      }
      const id = crypto.randomUUID();
      this.#approvals.set(id, { id, origin, namespace, tabId, waiters: [resolve] });
      this.#changed();
    });
  }

  async #call(method: string, params: Params | undefined, origin: string, tabId?: number): Promise<unknown> {
    const network = networkOf(method, networkList);
    if (!network) throw fail(ErrorCode.Unsupported, `${method} is not supported`);
    const { namespace } = network;
    const { session } = this.#deps;
    const state = session.state[namespace];
    const granted = ((await this.#deps.sites.getSites())[origin] ?? []).includes(namespace);
    if (!state || !granted) throw fail(ErrorCode.Unauthorized, 'Not connected');
    // The Wallet checks again; checking here first saves the user a round trip.
    const refused = network.functions[method].check(params, state);
    if (refused) throw new CallError(refused);
    const client = session.client;
    if (!client) throw fail(ErrorCode.Disconnected, 'No session');

    const { id, result } = client.start(method, params, origin);
    this.#pending.set(id, { id, method, origin, tabId });
    this.#changed();
    await this.#deps.activity.add({ id, timestamp: Date.now(), origin, method, namespace, status: 'pending', params });
    try {
      const value = await result;
      await this.#deps.activity.update(id, { status: 'success', result: value });
      return value;
    } catch (error) {
      const { code, message } = error as CallError;
      const status = code === ErrorCode.UserRejected ? 'rejected' : 'error';
      await this.#deps.activity.update(id, { status, error: { code, message } });
      throw error;
    } finally {
      this.#pending.delete(id);
      this.#changed();
    }
  }

  async #rpc(method: string, params: unknown): Promise<unknown> {
    if (!READ_ONLY_METHODS.has(method)) throw fail(ErrorCode.Unsupported, `${method} is not supported`);
    return this.#deps.rpc(this.#deps.session.state.eip155?.chain ?? 'eip155:1', method, params);
  }

  async #disconnect(namespace: string, origin: string): Promise<null> {
    await this.#deps.sites.revokeSite(origin, namespace);
    this.dispatchEvent(new Event('sites'));
    return null;
  }

  #changed(): void {
    this.dispatchEvent(new Event('change'));
  }
}
