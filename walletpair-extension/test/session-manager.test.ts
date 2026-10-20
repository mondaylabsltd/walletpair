// The extension's SessionManager with a fake PeerConnect and slow storage:
// concurrent restore, pair and end must never open two connections to one room.

import { describe, expect, it } from 'vitest';
import { CLOSE_GIVE_UP_MS, SessionManager, type PeerConnection, type PeerRoom, type SessionDeps } from '../src/lib/background/session';

let rooms = 0;

function fakeRoom(record?: string): PeerRoom {
  const id = record ?? `room-${++rooms}`;
  return { id, invite: `ws://relay.test#${id}`, paired: false, closing: false, toString: () => id };
}

class FakeConnection extends EventTarget implements PeerConnection {
  state: PeerConnection['state'] = 'waiting';
  reason: PeerConnection['reason'];
  readonly sent: string[] = [];
  constructor(readonly room: PeerRoom) {
    super();
  }
  send(data: Uint8Array): number {
    this.sent.push(new TextDecoder().decode(data));
    return this.sent.length - 1;
  }
  /** As PeerConnect: the connection stays until the other side acknowledges (acknowledge()). */
  closing = false;
  close(): void {
    this.closing = true;
  }
  acknowledge(): void {
    this.end('closed');
  }
  leave(): void {
    this.end('left');
  }
  end(reason: PeerConnection['reason']): void {
    this.state = 'closed';
    this.reason = reason;
    this.dispatchEvent(new Event('state'));
  }
}

function setup(options: { slowWrites?: number; now?: () => number } = {}) {
  const data: Record<string, unknown> = {};
  const connections: FakeConnection[] = [];
  const later = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), options.slowWrites ?? 0));
  const deps: SessionDeps = {
    peer: {
      create: () => fakeRoom(),
      parse: (record) => fakeRoom(record),
      connect: (room) => {
        const conn = new FakeConnection(room);
        connections.push(conn);
        return conn;
      },
    },
    relayUrl: async () => 'ws://relay.test',
    store: {
      getRoom: async () => data.room as string | undefined,
      // Like chrome.storage: the write is visible before its promise resolves.
      saveRoom: (record) => {
        data.room = record;
        return later(undefined);
      },
      getClosingRooms: async () => (data.closing ?? {}) as never,
      setClosingRoom: (id, room) =>
        later(void (data.closing = room ? { ...(data.closing as object), [id]: room } : Object.fromEntries(Object.entries((data.closing ?? {}) as object).filter(([k]) => k !== id)))),
      getSessionCache: async () => undefined,
      saveSessionCache: async () => {},
      getPendingIds: async () => [],
      savePendingIds: async () => {},
      clearSites: async () => {},
    },
    now: options.now,
  };
  return { session: new SessionManager(deps), connections, data, deps };
}

const live = (connections: FakeConnection[]) => connections.filter((c) => c.state !== 'closed' && !c.closing);

describe('SessionManager', () => {
  it('pairing while something restores opens one connection, which carries walletpair_connect', async () => {
    const { session, connections } = setup({ slowWrites: 20 });
    // A site's click starts pairing; while the room record is being written,
    // the side panel asks for state.
    const pairing = session.pair('https://app.example');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await Promise.all([session.restore(), session.restore(), pairing]);
    expect(connections).toHaveLength(1);
    expect(connections[0].sent.map((m) => JSON.parse(m).method)).toEqual(['walletpair_connect']);
    expect(JSON.parse(connections[0].sent[0]).origin).toBe('https://app.example');
    expect(session.phase).toBe('pairing');
    expect(session.uri).toBe(`walletpair:ws://relay.test#${connections[0].room.id}`);
  });

  it('pairing twice at once creates one room', async () => {
    const { session, connections } = setup({ slowWrites: 10 });
    await Promise.all([session.pair(), session.pair(), session.pair()]);
    expect(connections).toHaveLength(1);
  });

  it('a restarted worker restores the saved room once, however many callers ask', async () => {
    const first = setup();
    await first.session.pair();
    const restarted = new SessionManager(first.deps);
    await Promise.all([restarted.restore(), restarted.restore(), restarted.restore()]);
    expect(first.connections).toHaveLength(2);
    expect(first.connections[1].room.id).toBe(first.connections[0].room.id);
  });

  it('ending while pairing leaves no connection open and nothing saved', async () => {
    const { session, connections, data } = setup({ slowWrites: 10 });
    await Promise.all([session.pair(), session.end()]);
    expect(live(connections)).toHaveLength(0);
    expect(data.room).toBeUndefined();
    expect(session.phase).toBe('idle');
  });

  it('a closing room is resumed after a restart, forgotten once acknowledged, and given up after seven days', async () => {
    let now = 1_000;
    const { session, connections, data, deps } = setup({ now: () => now });
    await session.pair();
    await session.end();
    expect(Object.keys(data.closing as object)).toHaveLength(1);
    // The worker stops before the Wallet acknowledges; the next start keeps trying.
    const restarted = new SessionManager(deps);
    await restarted.restore();
    expect(connections).toHaveLength(2);
    expect(connections[1].room.id).toBe(connections[0].room.id);
    connections[1].acknowledge();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(data.closing).toEqual({});

    // A Wallet that never comes back is given up on.
    await new SessionManager(deps).pair();
    const third = new SessionManager(deps);
    await third.end();
    expect(Object.keys(data.closing as object)).toHaveLength(1);
    now += CLOSE_GIVE_UP_MS + 1;
    await new SessionManager(deps).restore();
    expect(data.closing).toEqual({});
  });
});
