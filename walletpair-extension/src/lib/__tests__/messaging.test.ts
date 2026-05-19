import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendToBackground, getExtensionState, onStateUpdate } from '../messaging';

// ── Mock chrome.runtime ────────────────────────────────────────────────

const listeners: Array<(message: any) => void> = [];

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn((handler: (message: any) => void) => {
        listeners.push(handler);
      }),
      removeListener: vi.fn((handler: (message: any) => void) => {
        const idx = listeners.indexOf(handler);
        if (idx !== -1) listeners.splice(idx, 1);
      }),
    },
  },
});

// ── Tests ──────────────────────────────────────────────────────────────

describe('messaging', () => {
  beforeEach(() => {
    listeners.length = 0;
    vi.clearAllMocks();
  });

  // ── sendToBackground ──────────────────────────────────────────────

  describe('sendToBackground', () => {
    it('sends the message via chrome.runtime.sendMessage', async () => {
      const mockResponse = { phase: 'idle' };
      (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await sendToBackground({ action: 'get-state' });

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'get-state' });
      expect(result).toEqual(mockResponse);
    });

    it('forwards the correct message shape for rpc-request', async () => {
      (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ result: '0x1' });

      await sendToBackground({
        action: 'rpc-request',
        id: 'test-1',
        payload: { method: 'eth_chainId' },
        origin: 'https://example.com',
      });

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'rpc-request',
        id: 'test-1',
        payload: { method: 'eth_chainId' },
        origin: 'https://example.com',
      });
    });
  });

  // ── getExtensionState ─────────────────────────────────────────────

  describe('getExtensionState', () => {
    it('sends get-state action and returns result', async () => {
      const mockState = { phase: 'connected' as const, wallet: { address: '0x1', chainId: 1 } };
      (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(mockState);

      const state = await getExtensionState();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'get-state' });
      expect(state).toEqual(mockState);
    });
  });

  // ── onStateUpdate ─────────────────────────────────────────────────

  describe('onStateUpdate', () => {
    it('subscribes a listener via chrome.runtime.onMessage', () => {
      const callback = vi.fn();
      onStateUpdate(callback);

      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
      expect(listeners).toHaveLength(1);
    });

    it('calls callback when state-update message is received', () => {
      const callback = vi.fn();
      onStateUpdate(callback);

      const state = { phase: 'pairing' as const, pairingUri: 'wp://test' };
      listeners[0]({ action: 'state-update', state });

      expect(callback).toHaveBeenCalledWith(state);
    });

    it('ignores messages with different actions', () => {
      const callback = vi.fn();
      onStateUpdate(callback);

      listeners[0]({ action: 'rpc-response', id: '1', result: '0x1' });

      expect(callback).not.toHaveBeenCalled();
    });

    it('returns an unsubscribe function that removes the listener', () => {
      const callback = vi.fn();
      const unsub = onStateUpdate(callback);

      expect(listeners).toHaveLength(1);

      unsub();

      expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledTimes(1);
    });
  });
});
