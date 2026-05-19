import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getSettings,
  saveSettings,
  getConnectedWallet,
  saveConnectedWallet,
  getSessionState,
  saveSessionState,
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
  remove: vi.fn(async (key: string) => {
    delete store[key];
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
      expect(settings.enabledChains).toContain('eip155:1');
      expect(settings.rpcUrls[1]).toBe('https://eth.llamarpc.com');
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
      const arg = chromeStorageLocal.set.mock.calls[0][0];
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
});
