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
  getConnectedWallet,
} from '@/lib/storage';
import type { ExtensionState, ConnectedWallet, BackgroundMessage, EIP1193Request } from '@/lib/types';

// ── Constants ───────────────────────────────────────────────────────────

const DEFAULT_RPC: Record<number, string> = {
  1: 'https://eth.llamarpc.com',
  10: 'https://mainnet.optimism.io',
  56: 'https://bsc-dataseed.binance.org',
  137: 'https://polygon-rpc.com',
  42161: 'https://arb1.arbitrum.io/rpc',
  8453: 'https://mainnet.base.org',
  43114: 'https://api.avax.network/ext/bc/C/rpc',
};

/** Read-only methods routed to a public RPC node, NOT the wallet */
const READ_ONLY_METHODS = new Set([
  'eth_blockNumber', 'eth_call', 'eth_estimateGas', 'eth_feeHistory',
  'eth_gasPrice', 'eth_maxPriorityFeePerGas',
  'eth_getBalance', 'eth_getCode', 'eth_getStorageAt', 'eth_getTransactionCount',
  'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getLogs',
  'eth_getBlockByNumber', 'eth_getBlockByHash',
  'eth_newFilter', 'eth_newBlockFilter', 'eth_getFilterChanges', 'eth_uninstallFilter',
  'eth_sendRawTransaction', 'eth_syncing',
]);

/** Deferred request timeout (5 minutes) */
const DEFERRED_TIMEOUT_MS = 5 * 60 * 1000;

// ── State ────────────────────────────────────────────────────────────────

let session: DAppSession | null = null;
let evmProvider: WalletPairProvider | null = null;
let transport: WebSocketTransport | null = null;
let state: ExtensionState = { phase: 'idle' };
let connectedWallet: ConnectedWallet | null = null;
let pairingInProgress = false;

// Pending RPC requests waiting for pairing to complete
const deferredRequests: Array<{
  id: string;
  payload: EIP1193Request;
  resolve: (v: { result?: unknown; error?: { code: number; message: string } }) => void;
  timer: ReturnType<typeof setTimeout>;
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

// ── RPC Proxy for read-only methods ─────────────────────────────────────

async function proxyRpcCall(chainId: number, method: string, params: unknown): Promise<unknown> {
  const settings = await getSettings();
  const rpcUrl = settings.rpcUrls?.[chainId] ?? DEFAULT_RPC[chainId];
  if (!rpcUrl) {
    throw Object.assign(new Error(`No RPC URL configured for chain ${chainId}`), { code: -32601 });
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method,
    params: params ?? [],
  });

  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    throw Object.assign(new Error(`RPC HTTP ${res.status}: ${res.statusText}`), { code: -32603 });
  }

  const json = await res.json();
  if (json.error) {
    throw Object.assign(new Error(json.error.message ?? 'RPC error'), { code: json.error.code ?? -32603 });
  }
  return json.result;
}

// ── Deferred Request Helpers ────────────────────────────────────────────

function rejectAllDeferred(code: number, message: string) {
  while (deferredRequests.length > 0) {
    const req = deferredRequests.shift()!;
    clearTimeout(req.timer);
    req.resolve({ error: { code, message } });
  }
}

function addDeferredRequest(
  id: string,
  payload: EIP1193Request,
  resolve: (v: { result?: unknown; error?: { code: number; message: string } }) => void,
) {
  const timer = setTimeout(() => {
    const idx = deferredRequests.findIndex((r) => r.id === id);
    if (idx !== -1) {
      const [req] = deferredRequests.splice(idx, 1);
      req!.resolve({ error: { code: 4001, message: 'Request timed out waiting for wallet pairing' } });
    }
  }, DEFERRED_TIMEOUT_MS);

  deferredRequests.push({ id, payload, resolve, timer });
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
        pairingInProgress = false;
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
  pairingInProgress = false;
  // Reject all deferred requests since session is gone
  rejectAllDeferred(4001, 'Session closed');

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

    // Restore connected wallet from storage and broadcast to all tabs
    const savedWallet = await getConnectedWallet();
    if (savedWallet) {
      connectedWallet = savedWallet;
      updateState({ wallet: { ...connectedWallet } });
      broadcastEvent('accountsChanged', [connectedWallet.address]);
    }

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

  // ── Local methods (always answerable) ──────────────────────────────────
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

  // ── wallet_getPermissions (local) ──────────────────────────────────────
  if (method === 'wallet_getPermissions') {
    if (connectedWallet && session?.phase === 'connected') {
      return { result: [{ parentCapability: 'eth_accounts' }] };
    }
    return { result: [] };
  }

  // ── Read-only methods → proxy to public RPC ───────────────────────────
  if (READ_ONLY_METHODS.has(method)) {
    const chainId = connectedWallet?.chainId ?? 1;
    try {
      const result = await proxyRpcCall(chainId, method, params);
      return { result };
    } catch (err: any) {
      return { error: { code: err.code ?? -32603, message: err.message ?? 'RPC proxy error' } };
    }
  }

  // ── Wallet methods: require connected session ─────────────────────────

  // wallet_requestPermissions acts like eth_requestAccounts
  const effectiveMethod = method === 'wallet_requestPermissions' ? 'eth_requestAccounts' : method;

  if (!session || session.phase !== 'connected') {
    if (effectiveMethod === 'eth_requestAccounts') {
      // Race condition guard: only one pairing at a time
      if (!pairingInProgress && (!session || session.phase === 'idle' || session.phase === 'closed')) {
        pairingInProgress = true;
        await createSession();
        openPopup();
      }
      // Defer until connected (with timeout)
      return new Promise((resolve) => {
        addDeferredRequest(id, payload, resolve);
      });
    }

    return { error: { code: 4100, message: 'Not connected. Call eth_requestAccounts first.' } };
  }

  // ── wallet_watchAsset: forward to wallet, silent success on failure ───
  if (method === 'wallet_watchAsset') {
    try {
      const result = await evmProvider!.request({ method, params });
      return { result };
    } catch {
      // Wallet doesn't support it — silent success
      return { result: true };
    }
  }

  // ── wallet_requestPermissions: trigger accounts request ───────────────
  if (method === 'wallet_requestPermissions') {
    try {
      await evmProvider!.request({ method: 'eth_requestAccounts', params: [] });
      return { result: [{ parentCapability: 'eth_accounts' }] };
    } catch (err: any) {
      return { error: { code: err.code ?? -32603, message: err.message ?? 'Request failed' } };
    }
  }

  // ── Forward all other wallet methods via SDK provider ──────────────────
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
    clearTimeout(req.timer);
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
          rejectAllDeferred(4001, 'User rejected wallet');
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
