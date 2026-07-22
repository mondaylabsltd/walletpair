import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getSettings,
  saveSettings,
  getConnectedWallet,
  saveConnectedWallet,
  getSessionState,
  saveSessionState,
  grantPermission,
  getPermissions,
  addActivityEntry,
  getActivityLog,
  clearConnectionState,
} from '../storage';

// ── Mock chrome.storage.local ──────────────────────────────────────────

const store: Record<string, unknown> = {};

const chromeStorageLocal = {
  get: vi.fn(async (key: string) => {
    return { [key]: store[key] };
  }),
  set: vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(store, items);
  }),
  remove: vi.fn(async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
  }),
};

vi.stubGlobal('chrome', {
  storage: { local: chromeStorageLocal },
});

// ── Tests ──────────────────────────────────────────────────────────────

describe('storage', () => {
  beforeEach(() => {
    // Clear the in-memory store and mocks
    for (const key of Object.keys(store)) delete store[key];
    vi.clearAllMocks();
  });

  // ── getSettings ────────────────────────────────────────────────────

  describe('getSettings', () => {
    it('returns defaults when storage is empty', async () => {
      const settings = await getSettings();
      expect(settings.relayUrl).toBe('wss://relay.walletpair.org/v1');
      expect(settings.autoConnect).toBe(true);
      expect(settings.rpcUrls).toEqual({});
    });

    it('merges stored values with defaults', async () => {
      store['settings'] = { relayUrl: 'wss://custom.relay' };
      const settings = await getSettings();
      expect(settings.relayUrl).toBe('wss://custom.relay');
      // Defaults still present
      expect(settings.autoConnect).toBe(true);
    });
  });

  // ── saveSettings ───────────────────────────────────────────────────

  describe('saveSettings', () => {
    it('merges partial update with existing settings', async () => {
      await saveSettings({ autoConnect: false });
      const settings = await getSettings();
      expect(settings.autoConnect).toBe(false);
      // Other defaults preserved
      expect(settings.relayUrl).toBe('wss://relay.walletpair.org/v1');
    });

    it('calls chrome.storage.local.set', async () => {
      await saveSettings({ relayUrl: 'wss://new' });
      expect(chromeStorageLocal.set).toHaveBeenCalled();
      const arg = chromeStorageLocal.set.mock.calls[0][0] as Record<string, Record<string, unknown>>;
      expect(arg['settings'].relayUrl).toBe('wss://new');
    });
  });

  // ── getConnectedWallet / saveConnectedWallet ──────────────────────

  describe('connectedWallet', () => {
    it('returns null when no wallet saved', async () => {
      const wallet = await getConnectedWallet();
      expect(wallet).toBeNull();
    });

    it('saves and retrieves wallet', async () => {
      const wallet = { address: '0xabc', chainId: 1, name: 'Test' };
      await saveConnectedWallet(wallet);
      const retrieved = await getConnectedWallet();
      expect(retrieved).toEqual(wallet);
    });

    it('removes wallet when saving null', async () => {
      store['connectedWallet'] = { address: '0xabc', chainId: 1 };
      await saveConnectedWallet(null);
      expect(chromeStorageLocal.remove).toHaveBeenCalledWith('connectedWallet');
      const retrieved = await getConnectedWallet();
      expect(retrieved).toBeNull();
    });
  });

  // ── getSessionState / saveSessionState ────────────────────────────

  describe('sessionState', () => {
    it('returns null when no session saved', async () => {
      const state = await getSessionState();
      expect(state).toBeNull();
    });

    it('saves and retrieves session state string', async () => {
      await saveSessionState('serialized-session-data');
      const state = await getSessionState();
      expect(state).toBe('serialized-session-data');
    });

    it('removes session state when saving null', async () => {
      store['sessionState'] = 'old-data';
      await saveSessionState(null);
      expect(chromeStorageLocal.remove).toHaveBeenCalledWith('sessionState');
      const state = await getSessionState();
      expect(state).toBeNull();
    });
  });

  describe('clearConnectionState', () => {
    it('removes all reconnect data but retains settings and permissions', async () => {
      store['sessionState'] = 'serialized-session-data';
      store['connectedWallet'] = { address: '0xabc', chainId: 1 };
      store['connectedAt'] = 123;
      store['settings'] = { relayUrl: 'wss://custom.relay' };
      store['permissions'] = { 'https://dapp.example': { granted: true } };

      await clearConnectionState();

      expect(chromeStorageLocal.remove).toHaveBeenCalledWith([
        'sessionState',
        'connectedWallet',
        'connectedAt',
      ]);
      expect(store['sessionState']).toBeUndefined();
      expect(store['connectedWallet']).toBeUndefined();
      expect(store['connectedAt']).toBeUndefined();
      expect(store['settings']).toEqual({ relayUrl: 'wss://custom.relay' });
      expect(store['permissions']).toBeDefined();
    });

    it('runs after an older in-flight snapshot write', async () => {
      let releaseWrite!: () => void;
      const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
      chromeStorageLocal.set.mockImplementationOnce(async (items: Record<string, unknown>) => {
        await writeGate;
        Object.assign(store, items);
      });

      const staleWrite = saveSessionState('stale-session');
      const clear = clearConnectionState();
      releaseWrite();
      await Promise.all([staleWrite, clear]);

      expect(store['sessionState']).toBeUndefined();
    });
  });

  // ── Regression: Fix #5 — Mutex for permissions ──────────────────

  describe('Fix #5: concurrent grantPermission (mutex)', () => {
    it('two concurrent grantPermission calls for different origins both succeed', async () => {
      await Promise.all([
        grantPermission('https://a.com'),
        grantPermission('https://b.com'),
      ]);
      const perms = await getPermissions();
      expect(perms['https://a.com']).toBeDefined();
      expect(perms['https://a.com'].granted).toBe(true);
      expect(perms['https://b.com']).toBeDefined();
      expect(perms['https://b.com'].granted).toBe(true);
    });

    it('three concurrent grantPermission calls preserve all entries', async () => {
      await Promise.all([
        grantPermission('https://x.com'),
        grantPermission('https://y.com'),
        grantPermission('https://z.com'),
      ]);
      const perms = await getPermissions();
      expect(Object.keys(perms)).toHaveLength(3);
      expect(perms['https://x.com'].granted).toBe(true);
      expect(perms['https://y.com'].granted).toBe(true);
      expect(perms['https://z.com'].granted).toBe(true);
    });
  });

  // ── Regression: Fix #5 — Mutex for activity log ─────────────────

  describe('Fix #5: concurrent addActivityEntry (mutex)', () => {
    it('two concurrent addActivityEntry calls both appear in the log', async () => {
      const entry1 = {
        id: 'e1',
        timestamp: Date.now(),
        origin: 'https://a.com',
        method: 'eth_sendTransaction',
        category: 'tx' as const,
        status: 'pending' as const,
      };
      const entry2 = {
        id: 'e2',
        timestamp: Date.now(),
        origin: 'https://b.com',
        method: 'personal_sign',
        category: 'sign' as const,
        status: 'pending' as const,
      };

      await Promise.all([
        addActivityEntry(entry1),
        addActivityEntry(entry2),
      ]);

      const log = await getActivityLog();
      expect(log).toHaveLength(2);
      const ids = log.map((e: { id: string }) => e.id);
      expect(ids).toContain('e1');
      expect(ids).toContain('e2');
    });

    it('three concurrent addActivityEntry calls all appear', async () => {
      const makeEntry = (id: string) => ({
        id,
        timestamp: Date.now(),
        origin: 'https://test.com',
        method: 'eth_call',
        category: 'read' as const,
        status: 'success' as const,
      });

      await Promise.all([
        addActivityEntry(makeEntry('a')),
        addActivityEntry(makeEntry('b')),
        addActivityEntry(makeEntry('c')),
      ]);

      const log = await getActivityLog();
      expect(log).toHaveLength(3);
      const ids = log.map((e: { id: string }) => e.id);
      expect(ids).toContain('a');
      expect(ids).toContain('b');
      expect(ids).toContain('c');
    });
  });
});
