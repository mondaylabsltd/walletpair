// The extension's WalletPair session: one PeerConnect room with one Wallet,
// as the DApp side (spec/core.md §2 and §4).

import { DAPP_INFO, NAMESPACES } from '../constants';
import type { Phase } from '../types';
import { CallError, WalletPairClient, type Transport } from '../walletpair/client';
import { namespaceRules } from '../walletpair/networks';
import { ErrorCode, rpcError, type SessionState, type WalletInfo } from '../walletpair/protocol';
import type { ClosingRoom, SessionCache } from '../storage';

/** How long to keep telling a Wallet that a room is closed before giving up (PeerConnect §5.5). */
export const CLOSE_GIVE_UP_MS = 7 * 24 * 3600 * 1000;

/** The parts of PeerConnect's Room and Connection the session uses. */
export interface PeerRoom {
  readonly id: string;
  readonly invite: string | undefined;
  readonly paired: boolean;
  readonly closing: boolean;
  toString(): string;
}

export interface PeerConnection extends Transport {
  readonly room: PeerRoom;
  readonly reason: 'left' | 'closed' | 'closed-by-peer' | undefined;
  close(): void;
  leave(): void;
}

export interface SessionDeps {
  peer: {
    create(relay: string): PeerRoom;
    parse(record: string): PeerRoom;
    connect(room: PeerRoom): PeerConnection;
  };
  relayUrl(): Promise<string>;
  store: {
    getRoom(): Promise<string | undefined>;
    saveRoom(record: string | undefined): Promise<void>;
    getClosingRooms(): Promise<Record<string, ClosingRoom>>;
    setClosingRoom(id: string, room: ClosingRoom | undefined): Promise<void>;
    getSessionCache(): Promise<SessionCache | undefined>;
    saveSessionCache(cache: SessionCache | undefined): Promise<void>;
    getPendingIds(): Promise<string[]>;
    savePendingIds(ids: string[]): Promise<void>;
    clearSites(): Promise<void>;
  };
  now?: () => number;
}

export interface Asked {
  state: SessionState;
  origin: string | undefined;
}

/**
 * Events: `change` (anything the side panel shows), `state` (what sites can
 * see may have changed), `ended` (the session is over).
 */
export class SessionManager extends EventTarget {
  phase: Phase = 'idle';
  uri: string | undefined;
  online = false;
  replaced = false;
  declined = false;
  wallet: WalletInfo | undefined;
  state: SessionState = {};

  readonly #deps: SessionDeps;
  #conn: PeerConnection | undefined;
  #client: WalletPairClient | undefined;
  #asking: { namespaces: string[]; result: Promise<Asked> } | undefined;
  #closing = new Map<string, PeerConnection>();
  #restoring: Promise<void> | undefined;

  constructor(deps: SessionDeps) {
    super();
    this.#deps = deps;
  }

  get client(): WalletPairClient | undefined {
    return this.#client;
  }

  /** Restores the saved session and finishes closing rooms. Runs on every worker start. */
  restore(): Promise<void> {
    this.#restoring ??= this.#restore().finally(() => (this.#restoring = undefined));
    return this.#restoring;
  }

  async #restore(): Promise<void> {
    const { store, peer } = this.#deps;
    const now = (this.#deps.now ?? Date.now)();
    for (const [id, closing] of Object.entries(await store.getClosingRooms())) {
      if (this.#closing.has(id)) continue;
      if (now - closing.since > CLOSE_GIVE_UP_MS) await store.setClosingRoom(id, undefined);
      else this.#finishClosing(id, peer.connect(peer.parse(closing.record)));
    }

    if (this.#conn) return;
    const record = await store.getRoom();
    if (!record) return;
    const cache = await store.getSessionCache();
    if (cache) {
      this.wallet = cache.wallet;
      this.state = cache.state;
    }
    this.#open(peer.parse(record));
    // Calls from before the restart can no longer be answered here (core §5).
    const stale = await store.getPendingIds();
    if (stale.length) {
      this.#client!.cancel(stale);
      await store.savePendingIds([]);
    }
    // Learn the current state (core §4.1).
    this.ask(NAMESPACES).catch(() => {});
  }

  /** Creates a room; the Wallet is asked for every namespace as soon as it joins. */
  async pair(origin?: string): Promise<void> {
    await this.restore();
    if (this.#conn) return;
    const room = this.#deps.peer.create(await this.#deps.relayUrl());
    await this.#deps.store.saveRoom(room.toString());
    this.#open(room);
    this.ask(NAMESPACES, origin).catch(() => {});
  }

  /**
   * walletpair_connect for the namespaces (core §4.1). Concurrent callers
   * share one request when it covers what they need. Resolves with the state
   * and the origin the request carried, which the Wallet showed the user.
   */
  ask(namespaces: string[], origin?: string): Promise<Asked> {
    const client = this.#client;
    if (!client) return Promise.reject(new CallError(rpcError(ErrorCode.Disconnected, 'No session')));
    const current = this.#asking;
    if (current && namespaces.every((ns) => current.namespaces.includes(ns))) return current.result;
    const wanted = [...new Set([...(current?.namespaces ?? []), ...namespaces])];
    const after = current ? current.result.catch(() => undefined) : Promise.resolve();
    const result = after.then(async (): Promise<Asked> => {
      this.declined = false;
      try {
        return { state: (await client.connect(DAPP_INFO, wanted, origin)).state, origin };
      } catch (error) {
        if ((error as CallError).code === ErrorCode.UserRejected) this.declined = true;
        throw error;
      } finally {
        this.#changed();
      }
    });
    const asking = { namespaces: wanted, result };
    this.#asking = asking;
    result
      .finally(() => {
        if (this.#asking === asking) this.#asking = undefined;
      })
      .catch(() => {});
    return result;
  }

  /** Ends the session for both sides (core §2.4); the Wallet is told when it is next reachable. */
  async end(): Promise<void> {
    await this.restore();
    const conn = this.#conn;
    if (!conn) return;
    conn.close();
    const id = conn.room.id;
    await this.#deps.store.setClosingRoom(id, { record: conn.room.toString(), since: (this.#deps.now ?? Date.now)() });
    this.#finishClosing(id, conn);
    await this.#forget();
  }

  #open(room: PeerRoom): void {
    const conn = this.#deps.peer.connect(room);
    const client = new WalletPairClient(conn, namespaceRules);
    this.#conn = conn;
    this.#client = client;
    this.replaced = false;
    this.#setPhase();

    conn.addEventListener('paired', () => {
      if (this.#conn !== conn) return;
      void this.#deps.store.saveRoom(conn.room.toString());
      this.#setPhase();
    });
    conn.addEventListener('replaced', () => {
      if (this.#conn !== conn) return;
      this.replaced = true;
      this.#changed();
    });
    conn.addEventListener('state', () => {
      if (this.#conn !== conn) return;
      this.online = conn.state === 'connected';
      if (this.online) this.replaced = false;
      if (conn.state !== 'closed') return this.#changed();
      // Leaving keeps the room for later; only a close ends the session.
      if (conn.reason === 'left') {
        this.#conn = undefined;
        this.#client = undefined;
        this.#changed();
      } else {
        void this.#forget();
      }
    });
    client.addEventListener('state', () => {
      if (this.#client !== client) return;
      this.state = client.state;
      this.wallet = client.wallet ?? this.wallet;
      void this.#deps.store.saveSessionCache({ wallet: this.wallet, state: this.state });
      this.#setPhase();
      this.dispatchEvent(new Event('state'));
    });
    client.addEventListener('pending', () => {
      if (this.#client !== client) return;
      void this.#deps.store.savePendingIds(client.pendingIds);
      this.#changed();
    });
  }

  #setPhase(): void {
    const room = this.#conn?.room;
    if (!room) this.phase = 'idle';
    else if (!room.paired) this.phase = 'pairing';
    else this.phase = Object.keys(this.state).length ? 'ready' : 'waiting';
    this.uri = this.phase === 'pairing' && room?.invite ? `walletpair:${room.invite}` : undefined;
    this.#changed();
  }

  /** Keeps a closing room connected until the Wallet acknowledges, then forgets it. */
  #finishClosing(id: string, conn: PeerConnection): void {
    this.#closing.set(id, conn);
    const check = () => {
      if (conn.state !== 'closed') return;
      conn.removeEventListener('state', check);
      this.#closing.delete(id);
      void this.#deps.store.setClosingRoom(id, undefined);
    };
    conn.addEventListener('state', check);
    check();
  }

  async #forget(): Promise<void> {
    const ended = this.#conn !== undefined;
    this.#conn = undefined;
    this.#client = undefined;
    this.#asking = undefined;
    this.state = {};
    this.wallet = undefined;
    this.online = false;
    this.replaced = false;
    this.declined = false;
    const { store } = this.#deps;
    await Promise.all([store.saveRoom(undefined), store.saveSessionCache(undefined), store.savePendingIds([]), store.clearSites()]);
    this.#setPhase();
    this.dispatchEvent(new Event('state'));
    if (ended) this.dispatchEvent(new Event('ended'));
  }

  #changed(): void {
    this.dispatchEvent(new Event('change'));
  }
}
