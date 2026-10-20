// WalletPair over real PeerConnect: the vendored PeerConnect client (the
// WebAssembly build the extension ships) and a real PeerConnect relay. Runs the
// extension's own SessionManager and Router, with storage in memory, against
// the reference Wallet. Needs PEERCONNECT_RELAY or PEERCONNECT_RELAY_BIN.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyMessage } from 'viem';
import { connect, Room } from '../vendor/peerconnect/index.js';
import { SessionManager, type PeerConnection, type PeerRoom, type SessionDeps } from '../src/lib/background/session';
import { Router } from '../src/lib/background/router';
import type { Sites } from '../src/lib/storage';
import { CallError, WalletPairClient } from '../src/lib/walletpair/client';
import { namespaceRules } from '../src/lib/walletpair/networks';
import { relayAvailable, startRelay, until } from './relay';
import { WalletDevice } from './wallet/device';
import type { Prompts } from './wallet/wallet';

const ORIGIN = 'https://app.example';

function memoryStore() {
  const data: Record<string, unknown> = {};
  let sites: Sites = {};
  const store: SessionDeps['store'] = {
    getRoom: async () => data.room as string | undefined,
    saveRoom: async (record) => void (data.room = record),
    getClosingRooms: async () => (data.closing ?? {}) as Record<string, never>,
    setClosingRoom: async (id, room) => {
      const closing = { ...((data.closing ?? {}) as Record<string, unknown>) };
      if (room) closing[id] = room;
      else delete closing[id];
      data.closing = closing;
    },
    getSessionCache: async () => data.cache as never,
    saveSessionCache: async (cache) => void (data.cache = cache),
    getPendingIds: async () => (data.pending ?? []) as string[],
    savePendingIds: async (ids) => void (data.pending = ids),
    clearSites: async () => void (sites = {}),
  };
  const siteStore = {
    getSites: async () => sites,
    grantSite: async (origin: string, ns: string) => void (sites = { ...sites, [origin]: [...new Set([...(sites[origin] ?? []), ns])] }),
    revokeSite: async (origin: string) => {
      const { [origin]: _, ...rest } = sites;
      sites = rest;
    },
  };
  return { data, store, siteStore };
}

const approveAll: Prompts = { connect: async (_, offered) => offered, approve: async () => true };

// Closing takes about 5 s: the closed peer lingers so a lost acknowledgement can be repeated (PeerConnect §5.5).
describe.skipIf(!relayAvailable)('over a real PeerConnect relay', { timeout: 60_000 }, () => {
  let relay: Awaited<ReturnType<typeof startRelay>>;
  beforeAll(async () => {
    relay = await startRelay();
  });
  afterAll(() => relay?.stop());

  it('the client pairs, connects and calls all three networks', async () => {
    const room = Room.create(relay.url);
    const conn = connect(room);
    const client = new WalletPairClient(conn, namespaceRules);
    const device = new WalletDevice(`walletpair:${room.invite}`, approveAll);
    const result = await client.connect({ name: 'Integration DApp' }, ['eip155', 'tron', 'solana']);
    expect(Object.keys(result.state).sort()).toEqual(['eip155', 'solana', 'tron']);
    const address = result.state.eip155.accounts[0] as `0x${string}`;
    const signature = (await client.call('personal_sign', ['0x6869', address])) as `0x${string}`;
    expect(await verifyMessage({ address, message: 'hi', signature })).toBe(true);
    await client.call('tron_signMessage', { account: result.state.tron.accounts[0], message: '6869' });
    await client.call('solana_signMessage', { account: result.state.solana.accounts[0], message: 'aGk=' });
    conn.close();
    await until(device.conn, ['state'], () => device.conn.state === 'closed');
    expect(device.conn.reason).toBe('closed-by-peer');
  });

  it('rejects a pairing URI that does not carry a PeerConnect invite', () => {
    expect(() => Room.join('?ch=0140446dc1742a90025fcd068df3a7338314e1da1649d520798c8581a0937d0c')).toThrow();
  });

  it('the extension background: pair, sites, calls, restarts and ending', async () => {
    const { data, store, siteStore } = memoryStore();
    const connections: PeerConnection[] = [];
    const deps: SessionDeps = {
      peer: {
        create: (url) => Room.create(url),
        parse: (record) => Room.parse(record),
        connect: (room: PeerRoom) => {
          const conn = connect(room as Room);
          connections.push(conn);
          return conn;
        },
      },
      relayUrl: async () => relay.url,
      store,
    };
    const makeRouter = (session: SessionManager) =>
      new Router({
        session,
        sites: siteStore,
        activity: { add: async () => {}, update: async () => {} },
        rpc: async () => {
          throw new Error('no node in this test');
        },
        surface: () => {},
      });

    let session = new SessionManager(deps);
    let router = makeRouter(session);

    // A site's first connect pairs, and the Wallet's prompt shows that site.
    const origins: (string | undefined)[] = [];
    const prompts: Prompts = {
      connect: async (_, offered, origin) => {
        origins.push(origin);
        return offered;
      },
      approve: async () => true,
    };
    const connecting = router.handle({ op: 'connect', namespace: 'eip155' }, ORIGIN, 1);
    await until(session, ['change'], () => session.phase === 'pairing' && Boolean(session.uri));
    const device = new WalletDevice(session.uri!, prompts);
    const evmState = (await connecting) as { accounts: string[] };
    expect(origins).toEqual([ORIGIN]);
    expect(session.phase).toBe('ready');
    // The Wallet's prompt named this site, so everything approved there is granted to it.
    expect(Object.keys(await router.siteState(ORIGIN)).sort()).toEqual(['eip155', 'solana', 'tron']);
    expect(await router.handle({ op: 'connect', namespace: 'tron' }, ORIGIN, 1)).toMatchObject({ chain: 'tron:3448148188' });
    expect(router.approvals).toEqual([]);

    const address = evmState.accounts[0] as `0x${string}`;
    const signed = (await router.handle({ op: 'call', method: 'personal_sign', params: ['0x6869', address] }, ORIGIN, 1)) as `0x${string}`;
    expect(await verifyMessage({ address, message: 'hi', signature: signed })).toBe(true);

    // Another site needs the user's approval in the extension.
    const other = 'https://other.example';
    await expect(router.handle({ op: 'call', method: 'personal_sign', params: ['0x6869', address] }, other, 2)).rejects.toMatchObject({ code: 4100 });
    const otherConnect = router.handle({ op: 'connect', namespace: 'solana' }, other, 2);
    await until(router, ['change'], () => router.approvals.length === 1);
    router.approve(router.approvals[0].id, true);
    expect(await otherConnect).toMatchObject({ chain: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' });

    // The service worker stops and starts again from storage.
    connections.at(-1)!.leave();
    session = new SessionManager(deps);
    router = makeRouter(session);
    await session.restore();
    await until(session, ['change', 'state'], () => session.phase === 'ready' && session.online);
    const again = (await router.handle({ op: 'call', method: 'personal_sign', params: ['0x6869', address] }, ORIGIN, 3)) as `0x${string}`;
    expect(await verifyMessage({ address, message: 'hi', signature: again })).toBe(true);

    // The Wallet restarts; requests made while it is away are delivered when it is back.
    device.stop();
    await until(session, ['change'], () => !session.online);
    const queued = router.handle({ op: 'call', method: 'personal_sign', params: ['0x6869', address] }, ORIGIN, 3);
    device.start();
    expect(await verifyMessage({ address, message: 'hi', signature: (await queued) as `0x${string}` })).toBe(true);

    // Chain changes in the Wallet reach the extension.
    device.wallet.setChain('eip155', 'eip155:137');
    await until(session, ['state'], () => session.state.eip155?.chain === 'eip155:137');

    // Ending: the Wallet learns it, and nothing is left in storage.
    await session.end();
    expect(session.phase).toBe('idle');
    await until(device.conn, ['state'], () => device.conn.state === 'closed');
    expect(device.conn.reason).toBe('closed-by-peer');
    await until(connections.at(-1)!, ['state'], () => connections.at(-1)!.state === 'closed');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(data.room).toBeUndefined();
    expect(data.closing).toEqual({});
    expect(await siteStore.getSites()).toEqual({});
  });

  it('declining in the Wallet rejects the site with 4001', async () => {
    const { store, siteStore } = memoryStore();
    const deps: SessionDeps = {
      peer: { create: (url) => Room.create(url), parse: (r) => Room.parse(r), connect: (room) => connect(room as Room) },
      relayUrl: async () => relay.url,
      store,
    };
    const session = new SessionManager(deps);
    const router = new Router({
      session,
      sites: siteStore,
      activity: { add: async () => {}, update: async () => {} },
      rpc: async () => null,
      surface: () => {},
    });
    const connecting = router.handle({ op: 'connect', namespace: 'tron' }, ORIGIN, 1);
    await until(session, ['change'], () => Boolean(session.uri));
    const device = new WalletDevice(session.uri!, { connect: async () => [], approve: async () => true });
    await expect(connecting).rejects.toBeInstanceOf(CallError);
    await expect(connecting).rejects.toMatchObject({ code: 4001 });
    expect(session.phase).toBe('waiting');
    expect(session.declined).toBe(true);
    await session.end();
    await until(device.conn, ['state'], () => device.conn.state === 'closed');
  });
});
