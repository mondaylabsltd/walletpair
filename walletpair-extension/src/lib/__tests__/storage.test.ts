import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addActivityEntry,
  clearSites,
  getActivityLog,
  getClosingRooms,
  getPendingIds,
  getRoom,
  getSettings,
  getSites,
  grantSite,
  isRelayUrl,
  revokeSite,
  saveRoom,
  savePendingIds,
  saveSettings,
  setClosingRoom,
  updateActivity,
} from '../storage';
import { DEFAULT_RELAY_URL } from '../constants';
import type { ActivityEntry } from '../types';

// Installed before the imports run: wxt/browser picks the API object when it loads.
const store = vi.hoisted(() => {
  const store: Record<string, unknown> = {};
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: structuredClone(store[key]) }),
        set: async (items: Record<string, unknown>) => {
          // Writes land after a delay, as real storage does, so lost updates would show.
          await new Promise((resolve) => setTimeout(resolve, 1));
          Object.assign(store, structuredClone(items));
        },
        remove: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
        },
      },
    },
  };
  return store;
});

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe('settings', () => {
  it('defaults, then merges what was saved', async () => {
    expect(await getSettings()).toEqual({ relayUrl: DEFAULT_RELAY_URL, rpcUrls: {} });
    await saveSettings({ relayUrl: 'wss://relay.example.com' });
    await saveSettings({ rpcUrls: { 1: 'https://rpc.example.com' } });
    expect(await getSettings()).toEqual({ relayUrl: 'wss://relay.example.com', rpcUrls: { 1: 'https://rpc.example.com' } });
  });

  it('accepts only PeerConnect relay URLs', () => {
    for (const ok of ['wss://relay.example.com', 'ws://127.0.0.1:8080', 'wss://example.com/peerconnect']) {
      expect(isRelayUrl(ok), ok).toBe(true);
    }
    for (const bad of ['https://relay.example.com', 'wss://relay.example.com/', 'wss://relay.example.com?x=1', 'wss://a#b', 'relay.example.com', '']) {
      expect(isRelayUrl(bad), bad).toBe(false);
    }
  });
});

describe('session records', () => {
  it('saves and clears the room record', async () => {
    await saveRoom('record');
    expect(await getRoom()).toBe('record');
    await saveRoom(undefined);
    expect(await getRoom()).toBeUndefined();
  });

  it('keeps closing rooms by id', async () => {
    await setClosingRoom('a', { record: 'ra', since: 1 });
    await setClosingRoom('b', { record: 'rb', since: 2 });
    await setClosingRoom('a', undefined);
    expect(await getClosingRooms()).toEqual({ b: { record: 'rb', since: 2 } });
    await setClosingRoom('b', undefined);
    expect(store.closingRooms).toBeUndefined();
  });

  it('stores pending ids, removing the key when there are none', async () => {
    await savePendingIds(['1', '2']);
    expect(await getPendingIds()).toEqual(['1', '2']);
    await savePendingIds([]);
    expect(store.pendingIds).toBeUndefined();
  });
});

describe('sites', () => {
  it('grants namespaces per origin without losing concurrent grants', async () => {
    await Promise.all([
      grantSite('https://a.example', 'eip155'),
      grantSite('https://a.example', 'solana'),
      grantSite('https://b.example', 'tron'),
      grantSite('https://a.example', 'eip155'),
    ]);
    expect(await getSites()).toEqual({ 'https://a.example': ['eip155', 'solana'], 'https://b.example': ['tron'] });
  });

  it('revokes one namespace or a whole site', async () => {
    await grantSite('https://a.example', 'eip155');
    await grantSite('https://a.example', 'tron');
    await grantSite('https://b.example', 'tron');
    await revokeSite('https://a.example', 'eip155');
    expect(await getSites()).toEqual({ 'https://a.example': ['tron'], 'https://b.example': ['tron'] });
    await revokeSite('https://a.example', 'tron');
    await revokeSite('https://b.example');
    expect(await getSites()).toEqual({});
    await grantSite('https://c.example', 'tron');
    await clearSites();
    expect(await getSites()).toEqual({});
  });
});

describe('activity', () => {
  const entry = (id: string): ActivityEntry => ({
    id,
    timestamp: 1,
    origin: 'https://a.example',
    method: 'personal_sign',
    namespace: 'eip155',
    status: 'pending',
  });

  it('keeps the newest 50 entries, newest first', async () => {
    for (let i = 0; i < 55; i++) await addActivityEntry(entry(String(i)));
    const log = await getActivityLog();
    expect(log).toHaveLength(50);
    expect(log[0].id).toBe('54');
  });

  it('updates an entry by id', async () => {
    await Promise.all([addActivityEntry(entry('a')), addActivityEntry(entry('b'))]);
    await updateActivity('a', { status: 'success', result: '0x1' });
    const log = await getActivityLog();
    expect(log.find((e) => e.id === 'a')).toMatchObject({ status: 'success', result: '0x1' });
    expect(log.find((e) => e.id === 'b')?.status).toBe('pending');
  });
});
