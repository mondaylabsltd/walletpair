/**
 * Background service worker - manages WalletPair session via SDK.
 *
 * Uses WalletPairProvider from walletpair-sdk for method mapping,
 * instead of reimplementing it.
 */
import { DAppSession, WebSocketTransport } from 'walletpair-sdk';
import { WalletPairProvider } from 'walletpair-sdk/evm/eip1193';
import { DEFAULT_RELAY_URL } from '@/lib/constants';
import {
  getSettings,
  getSessionState,
  saveSessionState,
  saveConnectedWallet,
} from '@/lib/storage';
import type { ExtensionState, ConnectedWallet, BackgroundMessage, EIP1193Request } from '@/lib/types';

// ── State ────────────────────────────────────────────────────────────────

let session: DAppSession | null = null;
let evmProvider: WalletPairProvider | null = null;
let transport: WebSocketTransport | null = null;
let state: ExtensionState = { phase: 'idle' };
let connectedWallet: ConnectedWallet | null = null;

// Pending RPC requests waiting for pairing to complete
const deferredRequests: Array<{
  id: string;
  payload: EIP1193Request;
  resolve: (v: { result?: unknown; error?: { code: number; message: string } }) => void;
}> = [];

// Map of connected content script ports
const contentPorts = new Map<number, chrome.runtime.Port>();

// ── State Management ─────────────────────────────────────────────────────

function updateState(patch: Partial<ExtensionState>) {
  state = { ...state, ...patch };
  // Broadcast to popup/options via runtime message
  chrome.runtime.sendMessage({ action: 'state-update', state }).catch(() => {});
}

function broadcastEvent(event: string, data: unknown) {
  const msg = { action: 'emit-event', event, data };
  for (const [, port] of contentPorts) {
    try { port.postMessage(msg); } catch {}
  }
}

// ── Session Management ───────────────────────────────────────────────────

function attachSessionListeners(autoAccepted: boolean) {
  if (!session) return;

  session.on('phase', (phase) => {
    switch (phase) {
      case 'waiting':
        updateState({ phase: 'pairing', pairingUri: session!.pairingUri });
        break;
      case 'pending_accept':
        updateState({ phase: 'pending_accept' });
        break;
      case 'connected':
        updateState({ phase: 'connected' });
        saveSessionState(session!.serialize()).catch(() => {});
        flushDeferredRequests();
        break;
      case 'disconnected':
        updateState({ phase: 'disconnected' });
        break;
      case 'closed':
        handleSessionClosed();
        break;
    }
  });

  session.on('pairingCode', (code) => {
    updateState({ pairingCode: code });
  });

  session.on('walletJoined', ({ meta }) => {
    updateState({ walletMeta: meta ? { name: meta.name, icon: meta.icon } : undefined });
  });

  // Use the SDK provider's event handling to keep state in sync
  if (evmProvider) {
    evmProvider.on('accountsChanged', (accounts: string[]) => {
      if (accounts.length > 0) {
        connectedWallet = {
          address: accounts[0]!,
          chainId: connectedWallet?.chainId ?? 1,
          name: session?.walletMeta?.name,
        };
        saveConnectedWallet(connectedWallet).catch(() => {});
        updateState({ wallet: { ...connectedWallet } });
      }
      broadcastEvent('accountsChanged', accounts);
    });

    evmProvider.on('chainChanged', (hexChainId: string) => {
      const numericChainId = parseInt(hexChainId, 16);
      if (connectedWallet) {
        connectedWallet.chainId = numericChainId;
        saveConnectedWallet(connectedWallet).catch(() => {});
        updateState({ wallet: { ...connectedWallet } });
      }
      broadcastEvent('chainChanged', hexChainId);
    });

    evmProvider.on('disconnect', () => {
      broadcastEvent('disconnect', undefined);
    });

    evmProvider.on('connect', (info: { chainId: string }) => {
      broadcastEvent('connect', info);
    });
  }
}

function handleSessionClosed() {
  updateState({
    phase: 'idle',
    pairingUri: undefined,
    pairingCode: undefined,
    wallet: undefined,
    walletMeta: undefined,
  });
  connectedWallet = null;
  saveSessionState(null).catch(() => {});
  saveConnectedWallet(null).catch(() => {});
  broadcastEvent('disconnect', undefined);
}

async function createSession(): Promise<void> {
  const settings = await getSettings();
  const relayUrl = settings.relayUrl || DEFAULT_RELAY_URL;

  // Clean up existing
  if (session) session.destroy();

  transport = new WebSocketTransport(relayUrl);
  session = new DAppSession({
    transport,
    name: 'WalletPair Extension',
    autoAccept: false,
    requestTimeout: 300_000,
  });

  // Use SDK's EVM provider for method mapping
  evmProvider = new WalletPairProvider({ session, chainId: 1 });

  attachSessionListeners(false);
  await session.createPairing();
}

async function tryReconnect(): Promise<boolean> {
  const saved = await getSessionState();
  if (!saved) return false;

  try {
    const settings = await getSettings();
    transport = new WebSocketTransport(settings.relayUrl || DEFAULT_RELAY_URL);
    session = new DAppSession({
      transport,
      name: 'WalletPair Extension',
      autoAccept: true,
      requestTimeout: 300_000,
    });

    evmProvider = new WalletPairProvider({ session, chainId: 1 });
    attachSessionListeners(true);

    const ok = session.restore(saved);
    if (!ok) return false;

    await session.reconnect();
    return true;
  } catch {
    return false;
  }
}

// ── RPC Request Handling ─────────────────────────────────────────────────

async function handleRpcRequest(
  id: string,
  payload: EIP1193Request,
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const { method, params } = payload;

  // If not connected and requesting accounts, start pairing
  if (!session || session.phase !== 'connected') {
    if (method === 'eth_requestAccounts') {
      if (!session || session.phase === 'idle' || session.phase === 'closed') {
        await createSession();
        openPopup();
      }
      // Defer until connected
      return new Promise((resolve) => {
        deferredRequests.push({ id, payload, resolve });
      });
    }

    // For non-account methods, check if we can answer locally
    if (method === 'eth_chainId') {
      const chainId = connectedWallet?.chainId ?? 1;
      return { result: `0x${chainId.toString(16)}` };
    }
    if (method === 'net_version') {
      return { result: String(connectedWallet?.chainId ?? 1) };
    }
    if (method === 'eth_accounts') {
      return { result: connectedWallet ? [connectedWallet.address] : [] };
    }

    return { error: { code: 4100, message: 'Not connected. Call eth_requestAccounts first.' } };
  }

  // Use SDK provider for method mapping and forwarding
  try {
    const result = await evmProvider!.request({ method, params });

    // Update local wallet state after account requests
    if (method === 'eth_requestAccounts') {
      const accounts = result as string[];
      if (accounts?.length > 0) {
        connectedWallet = {
          address: accounts[0]!,
          chainId: connectedWallet?.chainId ?? 1,
          name: session.walletMeta?.name,
        };
        saveConnectedWallet(connectedWallet).catch(() => {});
        updateState({ wallet: { ...connectedWallet } });
      }
    }

    return { result };
  } catch (err: any) {
    return {
      error: { code: err.code ?? -32603, message: err.message ?? 'Request failed' },
    };
  }
}

function flushDeferredRequests() {
  while (deferredRequests.length > 0) {
    const req = deferredRequests.shift()!;
    handleRpcRequest(req.id, req.payload).then((response) => {
      req.resolve(response);
    });
  }
}

function openPopup() {
  chrome.action.openPopup().catch(() => {
    chrome.windows.create({
      url: chrome.runtime.getURL('/popup.html'),
      type: 'popup',
      width: 380,
      height: 600,
      focused: true,
    }).catch(() => {});
  });
}

// ── Port & Message Handlers ──────────────────────────────────────────────

export default defineBackground(() => {
  // Handle port connections from content scripts
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'walletpair-content') return;

    const tabId = port.sender?.tab?.id;
    if (tabId !== undefined) contentPorts.set(tabId, port);

    port.onMessage.addListener(async (msg) => {
      if (msg.action === 'rpc-request') {
        const response = await handleRpcRequest(msg.id, msg.payload);
        try {
          port.postMessage({
            action: 'rpc-response',
            id: msg.id,
            method: msg.payload.method,
            ...response,
          });
        } catch {}
      }
    });

    port.onDisconnect.addListener(() => {
      if (tabId !== undefined) contentPorts.delete(tabId);
    });
  });

  // Handle messages from popup and fallback from content scripts
  chrome.runtime.onMessage.addListener((msg: BackgroundMessage, sender, sendResponse) => {
    (async () => {
      switch (msg.action) {
        case 'get-state':
          sendResponse(state);
          break;

        case 'start-pairing':
          await createSession();
          sendResponse(state);
          break;

        case 'accept-wallet':
          session?.acceptWallet();
          sendResponse({ ok: true });
          break;

        case 'reject-wallet':
          session?.rejectWallet();
          sendResponse({ ok: true });
          break;

        case 'disconnect':
          if (session) {
            session.close();
            session = null;
            evmProvider = null;
          }
          handleSessionClosed();
          sendResponse({ ok: true });
          break;

        case 'get-pairing-uri':
          sendResponse({ uri: state.pairingUri });
          break;

        case 'rpc-request': {
          const response = await handleRpcRequest(msg.id, msg.payload);
          sendResponse({
            action: 'rpc-response',
            id: msg.id,
            method: msg.payload.method,
            ...response,
          });
          break;
        }

        default:
          sendResponse({ error: 'Unknown action' });
      }
    })();
    return true; // Keep channel open for async
  });

  // Reconnect on startup
  tryReconnect().then((ok) => {
    if (ok) console.log('[WalletPair] Reconnected to previous session');
  });

  // Keep alive while connected
  setInterval(() => {
    if (session?.phase === 'connected') session.ping();
  }, 20_000);
});
