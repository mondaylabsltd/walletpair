/** Background service worker for the self-contained WalletPair protocol. */
import { DEFAULT_RELAY_URL } from '@/lib/constants';
import {
  getSettings,
  getSessionState,
  saveSessionState,
  saveConnectedWallet,
  getConnectedWallet,
  isPermitted,
  grantPermission,
  revokePermission,
  getPermissions,
  saveConnectedAt,
  getConnectedAt,
  clearConnectionState,
  addActivityEntry,
  updateActivityStatus,
} from '@/lib/storage';
import { READ_ONLY_METHODS, proxyRpcCall } from '@/lib/rpc-proxy';
import { WALLET_METHODS } from '@/lib/protocols/ethereum/methods';
import { WalletPairSession, type EthereumEvent } from '@/lib/walletpair/session';
import type { ExtensionState, ConnectedWallet, BackgroundMessage, EIP1193Request, ActivityEntry, RpcErrorInfo } from '@/lib/types';

// ── Constants ───────────────────────────────────────────────────────────

/** Deferred request timeout (5 minutes) */
const DEFERRED_TIMEOUT_MS = 5 * 60 * 1000;

/** Maximum session age (24 hours) */
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// ── State ────────────────────────────────────────────────────────────────

let session: WalletPairSession | null = null;
let state: ExtensionState = { phase: 'idle' };
let connectedWallet: ConnectedWallet | null = null;
let activeChainId = 1;
let pairingInProgress = false;

type RpcResponse = { result?: unknown; error?: RpcErrorInfo };

const DAPP_META = Object.freeze({
  name: 'WalletPair Extension',
  url: 'https://walletpair.org',
  icon: 'https://walletpair.org/icon.png',
});

// Exponential backoff state for reconnection
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
/** Explicit close/expiry disables every in-flight and future reconnect until a
 * new pairing is started. */
let reconnectAllowed = true;
/** Guards against overlapping rebuild-and-reconnect attempts (scheduleReconnect,
 * keepalive-alarm backstop, and SW-startup can all fire near-simultaneously). */
let reconnecting = false;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

function scheduleReconnect() {
  if (!reconnectAllowed || reconnectTimer) return; // stopped or already scheduled
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt), RECONNECT_MAX_MS);
  reconnectAttempt++;
  console.warn(`[WalletPair] Scheduling reconnect in ${delay}ms (attempt ${reconnectAttempt})`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (!reconnectAllowed) return;
    const ok = await tryReconnect();
    if (ok && reconnectAllowed) {
      reconnectAttempt = 0;
      console.log('[WalletPair] Reconnected successfully');
    } else if (reconnectAllowed && await getSessionState().catch(() => null)) {
      scheduleReconnect();
    }
  }, delay);
}

function resetReconnectBackoff() {
  reconnectAttempt = 0;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function startKeepalive(sessionRef: WalletPairSession) {
  stopKeepalive();
  keepaliveTimer = setInterval(() => {
    if (session === sessionRef && sessionRef.phase === 'connected') {
      sessionRef.ping(currentCaip2());
    }
  }, 20_000);
}

function stopKeepalive() {
  if (!keepaliveTimer) return;
  clearInterval(keepaliveTimer);
  keepaliveTimer = null;
}

// Pending RPC requests waiting for pairing to complete
const deferredRequests: Array<{
  id: string;
  payload: EIP1193Request;
  origin?: string;
  resolve: (v: RpcResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}> = [];

// Pending tx/sign confirmations awaiting user approval
interface PendingConfirmation {
  id: string;
  method: string;
  params: unknown;
  origin: string;
  resolve: (v: RpcResponse) => void;
  windowId?: number;
  timeoutTimer?: ReturnType<typeof setTimeout>;
}
const pendingConfirmations = new Map<string, PendingConfirmation>();

// Map of connected content script ports
const contentPorts = new Map<number, chrome.runtime.Port>();

// ── State Management ─────────────────────────────────────────────────────

function updateState(patch: Partial<ExtensionState>) {
  state = { ...state, ...patch };
  // Broadcast to popup/options via runtime message
  chrome.runtime.sendMessage({ action: 'state-update', state }).catch((e) => console.warn('[WalletPair]', e));
}

/** Resolve the page origin behind a content-script port's sender, if determinable. */
function senderOrigin(sender: { origin?: string; url?: string } | undefined): string | undefined {
  if (sender?.origin) return sender.origin;
  if (!sender?.url) return undefined;
  try {
    return new URL(sender.url).origin;
  } catch {
    return undefined;
  }
}

async function stateVisibleToSender(sender: { tab?: unknown; origin?: string; url?: string } | undefined): Promise<ExtensionState> {
  if (!sender?.tab) return state; // Extension UI pages receive the full state.
  const origin = senderOrigin(sender);
  if (!origin || !(await isPermitted(origin))) return { phase: 'idle' };
  return state;
}

function broadcastEvent(event: string, data: unknown) {
  const msg = { action: 'emit-event', event, data };
  // Only deliver wallet events (accountsChanged/chainChanged/connect/disconnect)
  // to origins the user has authorized — parity with injected wallets like
  // MetaMask. Fail closed: a tab whose origin can't be determined or isn't
  // permitted never observes the wallet's account/chain state. The connecting
  // dApp still gets its initial state from the eth_requestAccounts result.
  for (const [, port] of contentPorts) {
    const origin = senderOrigin(port.sender);
    if (!origin) continue;
    isPermitted(origin)
      .then((ok) => {
        if (!ok) return;
        try {
          port.postMessage(msg);
        } catch {
          /* port closed */
        }
      })
      .catch(() => {
        /* storage error — do not leak the event */
      });
  }
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
  resolve: (v: RpcResponse) => void,
  origin?: string,
) {
  const timer = setTimeout(() => {
    const idx = deferredRequests.findIndex((r) => r.id === id);
    if (idx !== -1) {
      const [req] = deferredRequests.splice(idx, 1);
      req!.resolve({ error: { code: 4001, message: 'Request timed out waiting for wallet pairing' } });
    }
  }, DEFERRED_TIMEOUT_MS);

  deferredRequests.push({ id, payload, origin, resolve, timer });
}

// ── Session Management ───────────────────────────────────────────────────

// Track listener removers so we can clean up before re-attaching
let cleanupSessionListeners: (() => void) | null = null;

function attachSessionListeners() {
  if (!session) return;
  cleanupSessionListeners?.();

  const sessionRef = session;
  const onPhase = (phase: string) => {
    switch (phase) {
      case 'waiting':
        updateState({ phase: 'pairing', pairingUri: sessionRef.pairingUri });
        break;
      case 'connected':
        updateState({ phase: 'connected', walletMeta: sessionRef.walletMeta });
        pairingInProgress = false;
        resetReconnectBackoff();
        startKeepalive(sessionRef);
        saveSessionState(sessionRef.serialize()).catch((e) => console.warn('[WalletPair]', e));
        saveConnectedAt(Date.now()).catch((e) => console.warn('[WalletPair]', e));
        chrome.alarms.clear('walletpair-keepalive', () => {
          chrome.alarms.create('walletpair-keepalive', { periodInMinutes: 0.5 });
        });
        flushDeferredRequests();
        break;
      case 'disconnected':
        stopKeepalive();
        updateState({ phase: 'disconnected' });
        scheduleReconnect();
        break;
      case 'closed':
        void handleSessionClosed().catch((e) => console.warn('[WalletPair]', e));
        break;
    }
  };
  const onFingerprint = (code: unknown) => updateState({ sessionFingerprint: String(code) });
  const onWalletJoined = ({ meta }: { meta?: { name?: string; icon?: string } }) => {
    updateState({ walletMeta: meta ? { name: meta.name, icon: meta.icon } : undefined });
  };
  const onEthereumEvent = (event: EthereumEvent) => handleEthereumEvent(sessionRef, event);

  sessionRef.on('phase', onPhase);
  sessionRef.on('sessionFingerprint', onFingerprint);
  sessionRef.on('walletJoined', onWalletJoined);
  sessionRef.on('ethereumEvent', onEthereumEvent);

  cleanupSessionListeners = () => {
    sessionRef.off('phase', onPhase);
    sessionRef.off('sessionFingerprint', onFingerprint);
    sessionRef.off('walletJoined', onWalletJoined);
    sessionRef.off('ethereumEvent', onEthereumEvent);
  };
}

function handleEthereumEvent(sessionRef: WalletPairSession, event: EthereumEvent) {
  if (event.event === 'accountsChanged') {
    if (!Array.isArray(event.data) || !event.data.every((account) => typeof account === 'string')) return;
    const accounts = event.data as string[];
    if (accounts.length > 0) {
      const chainId = activeChainId;
      connectedWallet = {
        address: accounts[0]!,
        chainId,
        name: sessionRef.walletMeta?.name,
        icon: sessionRef.walletMeta?.icon,
        protocolName: 'ethereum',
        chainRef: String(chainId),
      };
      saveConnectedWallet(connectedWallet).catch((e) => console.warn('[WalletPair]', e));
      updateState({ wallet: { ...connectedWallet } });
    } else {
      connectedWallet = null;
      saveConnectedWallet(null).catch((e) => console.warn('[WalletPair]', e));
      updateState({ wallet: undefined });
    }
    broadcastEvent('accountsChanged', accounts);
    return;
  }

  if (event.event === 'chainChanged') {
    if (typeof event.data !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(event.data)) return;
    const numericChainId = Number.parseInt(event.data, 16);
    if (!Number.isSafeInteger(numericChainId)) return;
    activeChainId = numericChainId;
    if (connectedWallet) {
      connectedWallet = { ...connectedWallet, chainId: numericChainId, chainRef: String(numericChainId) };
      saveConnectedWallet(connectedWallet).catch((e) => console.warn('[WalletPair]', e));
      updateState({ wallet: { ...connectedWallet } });
    }
    broadcastEvent('chainChanged', event.data);
    return;
  }

  if (event.event === 'connect') {
    const data = event.data as { chainId?: unknown };
    if (typeof data?.chainId === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(data.chainId)) {
      const numericChainId = Number.parseInt(data.chainId, 16);
      if (Number.isSafeInteger(numericChainId)) activeChainId = numericChainId;
    }
  }

  broadcastEvent(event.event, event.data);
}

async function handleSessionClosed(): Promise<void> {
  pairingInProgress = false;
  reconnectAllowed = false;
  resetReconnectBackoff();
  stopKeepalive();
  // Reject all deferred requests since session is gone
  rejectAllDeferred(4001, 'Session closed');

  // Clear keepalive alarm
  chrome.alarms.clear('walletpair-keepalive');

  updateState({
    phase: 'idle',
    pairingUri: undefined,
    sessionFingerprint: undefined,
    wallet: undefined,
    walletMeta: undefined,
  });
  connectedWallet = null;
  activeChainId = 1;
  await clearConnectionState();
  broadcastEvent('disconnect', undefined);
}

async function createSession(): Promise<void> {
  const settings = await getSettings();
  const relayUrl = settings.relayUrl || DEFAULT_RELAY_URL;

  cleanupSessionListeners?.();
  cleanupSessionListeners = null;
  session?.destroy();
  reconnectAllowed = true;
  pairingInProgress = true;
  session = new WalletPairSession({
    relayUrl,
    meta: DAPP_META,
    requestTimeout: 60_000,
    persist: saveSessionState,
  });
  attachSessionListeners();
  await session.createPairing();
}

async function tryReconnect(): Promise<boolean> {
  // Prevent overlapping rebuilds: the keepalive-alarm backstop, scheduleReconnect,
  // and SW-startup can all call this near-simultaneously, which would otherwise
  // create several competing session instances.
  if (!reconnectAllowed || reconnecting) return false;
  reconnecting = true;
  try {
    return await doTryReconnect();
  } finally {
    reconnecting = false;
  }
}

async function doTryReconnect(): Promise<boolean> {
  const saved = await getSessionState();
  if (!saved || !reconnectAllowed) return false;

  // Check if session has expired (24-hour limit)
  const connectedAt = await getConnectedAt();
  if (!reconnectAllowed) return false;
  if (connectedAt && Date.now() - connectedAt > SESSION_MAX_AGE_MS) {
    cleanupSessionListeners?.();
    cleanupSessionListeners = null;
    const expiredSession = session;
    session = null;
    if (expiredSession) await expiredSession.closeAndDrain();
    await handleSessionClosed();
    return false;
  }

  try {
    const settings = await getSettings();
    if (!reconnectAllowed) return false;
    cleanupSessionListeners?.();
    cleanupSessionListeners = null;
    session?.destroy();
    const restored = new WalletPairSession({
      relayUrl: settings.relayUrl || DEFAULT_RELAY_URL,
      meta: DAPP_META,
      requestTimeout: 60_000,
      persist: saveSessionState,
    });
    const ok = restored.restore(saved);
    if (!ok) {
      reconnectAllowed = false;
      await clearConnectionState();
      return false;
    }
    if (!reconnectAllowed) {
      restored.destroy();
      return false;
    }
    session = restored;
    attachSessionListeners();
    updateState({
      phase: restored.walletMeta ? 'disconnected' : 'pairing',
      pairingUri: restored.pairingUri,
      sessionFingerprint: restored.pairingCode,
      walletMeta: restored.walletMeta,
    });
    await session.reconnect();
    if (!reconnectAllowed || session !== restored) return false;

    // Restore connected wallet from storage and broadcast to all tabs
    const savedWallet = await getConnectedWallet();
    if (savedWallet) {
      connectedWallet = savedWallet;
      activeChainId = savedWallet.chainId;
      updateState({ wallet: { ...connectedWallet } });
      broadcastEvent('accountsChanged', [connectedWallet.address]);
    }

    return true;
  } catch {
    return false;
  }
}

// ── Confirmation Popup ──────────────────────────────────────────────────

/** Confirmation popup timeout (5 minutes) */
const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

function requestUserConfirmation(
  method: string,
  params: unknown,
  origin: string,
): Promise<RpcResponse> {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  const confirmId = `confirm-${Array.from(buf, b => b.toString(16).padStart(2, '0')).join('')}`;

  return new Promise((resolve) => {
    // Fix #8: Timeout so popups don't hang forever if user ignores them
    const timeoutTimer = setTimeout(() => {
      const pending = pendingConfirmations.get(confirmId);
      if (pending) {
        pendingConfirmations.delete(confirmId);
        if (pending.windowId) {
          chrome.windows.remove(pending.windowId).catch(() => {});
        }
        resolve({ error: { code: 4001, message: 'Confirmation timed out' } });
      }
    }, CONFIRM_TIMEOUT_MS);

    pendingConfirmations.set(confirmId, { id: confirmId, method, params, origin, resolve, timeoutTimer });

    chrome.windows.create({
      url: chrome.runtime.getURL(`/confirm.html?id=${confirmId}`),
      type: 'popup',
      width: 400,
      height: 520,
      focused: true,
    }).then(
      (win: { id?: number }) => {
        const pending = pendingConfirmations.get(confirmId);
        // Fix #9: If confirmation was already resolved (e.g. by timeout), skip
        if (pending) pending.windowId = win?.id;
      },
      () => {
        // If popup fails to open, reject the request
        clearTimeout(timeoutTimer);
        pendingConfirmations.delete(confirmId);
        resolve({ error: { code: -32603, message: 'Failed to open confirmation popup' } });
      },
    );
  });
}

async function forwardToWallet(
  method: string,
  params: unknown[] | Record<string, unknown> | undefined,
): Promise<RpcResponse> {
  try {
    if (!session) throw Object.assign(new Error('WalletPair channel is disconnected'), { code: 4900 });
    const result = await session.request({ method, params }, currentCaip2());
    return { result };
  } catch (err: any) {
    return { error: { code: err.code ?? -32603, message: err.message ?? 'Request failed', data: err.data } };
  }
}

// ── Activity Logging ────────────────────────────────────────────────────

function classifyMethod(method: string): ActivityEntry['category'] {
  if (['eth_requestAccounts', 'wallet_requestPermissions'].includes(method)) return 'auth';
  if (['personal_sign', 'eth_signTypedData', 'eth_signTypedData_v1', 'eth_signTypedData_v3', 'eth_signTypedData_v4'].includes(method)) return 'sign';
  if (['eth_sendTransaction', 'wallet_sendCalls'].includes(method)) return 'tx';
  if (['eth_chainId', 'net_version', 'eth_accounts', 'wallet_getPermissions'].includes(method)) return 'local';
  return 'read';
}

function currentCaip2(): string {
  return `eip155:${activeChainId}`;
}

function explicitChainMatches(method: string, params: unknown, active: number): boolean {
  if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain' || method === 'wallet_getCapabilities') {
    return true;
  }
  const list = Array.isArray(params) ? params : [];
  let candidate: unknown;
  if (['eth_sendTransaction', 'eth_call', 'eth_estimateGas', 'eth_createAccessList'].includes(method)) {
    candidate = isObject(list[0]) ? list[0].chainId : undefined;
  } else if (method === 'wallet_sendCalls') {
    candidate = isObject(list[0]) ? list[0].chainId : undefined;
  } else if (method.startsWith('eth_signTypedData')) {
    const raw = list.find((value) => isObject(value) || (typeof value === 'string' && value.startsWith('{')));
    let typedData = raw;
    if (typeof raw === 'string') {
      try { typedData = JSON.parse(raw); } catch { return false; }
    }
    candidate = isObject(typedData) && isObject(typedData.domain) ? typedData.domain.chainId : undefined;
  }
  if (candidate === undefined) return true;
  const parsed = parseExplicitChainId(candidate);
  return parsed !== null && parsed === BigInt(active);
}

function parseExplicitChainId(value: unknown): bigint | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  if (typeof value !== 'string' || !/^(?:0x(?:0|[1-9a-f][0-9a-f]*)|(?:0|[1-9][0-9]*))$/.test(value)) return null;
  try { return BigInt(value); } catch { return null; }
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ── RPC Request Handling ─────────────────────────────────────────────────

async function handleRpcRequest(
  id: string,
  payload: EIP1193Request,
  origin?: string,
): Promise<RpcResponse> {
  const { method, params } = payload;
  if (typeof method !== 'string' || method.length === 0 || new TextEncoder().encode(method).length > 128) {
    return { error: { code: -32600, message: 'Invalid EIP-1193 request' } };
  }
  if (params !== undefined && !Array.isArray(params) && (typeof params !== 'object' || params === null)) {
    return { error: { code: -32602, message: 'params must be an array or object' } };
  }
  const permitted = origin ? await isPermitted(origin) : true;

  // Activity logging setup
  const category = classifyMethod(method);
  const activityId = `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const shouldLog = category !== 'local';

  if (shouldLog) {
    addActivityEntry({
      id: activityId,
      timestamp: Date.now(),
      origin: origin || 'unknown',
      method,
      category,
      status: 'pending',
      params,
    }).catch(() => {});
  }

  if (category === 'sign' || category === 'tx') {
    updateState({ signingInProgress: { method, origin: origin || 'unknown' } });
  }

  // ── Local methods (always answerable) ──────────────────────────────────
  if (method === 'eth_chainId') {
    return { result: `0x${activeChainId.toString(16)}` };
  }
  if (method === 'net_version') {
    return { result: String(activeChainId) };
  }
  if (method === 'eth_accounts') {
    // Only return accounts if the origin is permitted
    if (!permitted) return { result: [] };
    return { result: connectedWallet ? [connectedWallet.address] : [] };
  }

  // ── wallet_getPermissions (local) ──────────────────────────────────────
  if (method === 'wallet_getPermissions') {
    if (permitted && connectedWallet && session?.phase === 'connected') {
      return { result: [{ parentCapability: 'eth_accounts' }] };
    }
    return { result: [] };
  }

  if (!explicitChainMatches(method, params, activeChainId)) {
    const mismatch = { code: -32602, message: 'Explicit chainId does not match the authenticated CAIP-2 context' };
    if (shouldLog) updateActivityStatus(activityId, 'error', { error: mismatch }).catch(() => {});
    return { error: mismatch };
  }

  // ── Read-only methods → proxy to public RPC ───────────────────────────
  if (READ_ONLY_METHODS.has(method)) {
    const chainId = activeChainId;
    try {
      const result = await proxyRpcCall(chainId, method, params);
      if (shouldLog) updateActivityStatus(activityId, 'success', { result }).catch(() => {});
      return { result };
    } catch (err: any) {
      const error = { code: err.code ?? -32603, message: err.message ?? 'RPC proxy error' };
      if (shouldLog) updateActivityStatus(activityId, 'error', { error }).catch(() => {});
      return { error };
    }
  }

  if (!WALLET_METHODS.has(method)) {
    const unsupported = { code: 4200, message: `${method} is not supported` };
    if (shouldLog) updateActivityStatus(activityId, 'error', { error: unsupported }).catch(() => {});
    if (category === 'sign' || category === 'tx') updateState({ signingInProgress: undefined });
    return { error: unsupported };
  }

  if (!session || session.phase !== 'connected') {
    if (method === 'eth_requestAccounts' || method === 'wallet_requestPermissions') {
      if (!pairingInProgress && (!session || session.phase === 'idle' || session.phase === 'closed')) {
        pairingInProgress = true;
        await createSession();
        openPopup();
      }
      return new Promise((resolve) => {
        addDeferredRequest(id, payload, (response) => {
          if (origin && !response.error) {
            grantPermission(origin).catch((e) => console.warn('[WalletPair]', e));
          }
          if (shouldLog) {
            updateActivityStatus(activityId, response.error ? 'error' : 'success', response).catch(() => {});
          }
          resolve(response);
        }, origin);
      });
    }

    const notConnectedError = { code: 4100, message: 'Not connected. Call eth_requestAccounts first.' };
    if (shouldLog) updateActivityStatus(activityId, 'error', { error: notConnectedError }).catch(() => {});
    if (category === 'sign' || category === 'tx') updateState({ signingInProgress: undefined });
    return { error: notConnectedError };
  }

  if (!permitted && method !== 'eth_requestAccounts' && method !== 'wallet_requestPermissions') {
    const notPermittedError = { code: 4100, message: 'Not permitted. Call eth_requestAccounts first.' };
    if (shouldLog) updateActivityStatus(activityId, 'error', { error: notPermittedError }).catch(() => {});
    if (category === 'sign' || category === 'tx') updateState({ signingInProgress: undefined });
    return { error: notPermittedError };
  }
  try {
    const result = await session.request({ method, params }, currentCaip2());

    if (method === 'eth_requestAccounts') {
      if (!Array.isArray(result) || !result.every((account) => typeof account === 'string' && /^0x[0-9a-fA-F]{40}$/.test(account))) {
        throw Object.assign(new Error('Wallet returned invalid eth_requestAccounts data'), { code: -32603 });
      }
      const accounts = result as string[];
      if (accounts.length > 0) {
        const chainId = activeChainId;
        connectedWallet = {
          address: accounts[0]!,
          chainId,
          name: session.walletMeta?.name,
          icon: session.walletMeta?.icon,
          protocolName: 'ethereum',
          chainRef: String(chainId),
        };
        saveConnectedWallet(connectedWallet).catch((e) => console.warn('[WalletPair]', e));
        updateState({ wallet: { ...connectedWallet } });
        if (origin) grantPermission(origin).catch((e) => console.warn('[WalletPair]', e));
      }
    }
    if (method === 'wallet_requestPermissions' && origin) {
      grantPermission(origin).catch((e) => console.warn('[WalletPair]', e));
    }

    if (shouldLog) updateActivityStatus(activityId, 'success', { result }).catch(() => {});
    if (category === 'sign' || category === 'tx') updateState({ signingInProgress: undefined });
    return { result };
  } catch (err: any) {
    const code = err.code
      ?? (err instanceof RangeError && /64 KiB|exceeds/.test(err.message) ? -32005
        : err instanceof TypeError ? -32602 : -32603);
    const error = { code, message: err.message ?? 'Request failed', data: err.data };
    if (shouldLog) {
      const status = err.code === 4001 ? 'rejected' : 'error';
      updateActivityStatus(activityId, status, { error }).catch(() => {});
    }
    if (category === 'sign' || category === 'tx') updateState({ signingInProgress: undefined });
    return { error };
  }
}

function flushDeferredRequests() {
  while (deferredRequests.length > 0) {
    const req = deferredRequests.shift()!;
    clearTimeout(req.timer);
    handleRpcRequest(req.id, req.payload, req.origin).then((response) => {
      req.resolve(response);
    });
  }
}

async function openPopup() {
  // Side-panel only: never spawn a separate popup window or action popup.
  // Auto-opening the panel reliably happens via the 'open-panel' message that
  // carries the dApp's user gesture (see onMessage). This best-effort attempt
  // covers non-gesture flows; it silently no-ops when activation is missing.
  try {
    let windowId = (await chrome.windows.getLastFocused().catch(() => null))?.id;
    if (windowId == null) windowId = (await chrome.windows.getCurrent().catch(() => null))?.id;
    if (windowId != null) await (chrome.sidePanel as any).open({ windowId });
  } catch {
    // No user activation here — the gesture-forwarded 'open-panel' path handles
    // the common case, so just leave the panel closed rather than open a window.
  }
}

// ── Port & Message Handlers ──────────────────────────────────────────────

export default defineBackground(() => {
  // Default to side panel mode: clicking the extension icon opens side panel
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  // Dedicated listener for the gesture-forwarded panel open. Kept separate from
  // the async handler below so sidePanel.open() runs synchronously within the
  // user activation propagated from the content script's sendMessage — this is
  // what makes the side panel auto-open on a dApp connect click.
  chrome.runtime.onMessage.addListener((msg: BackgroundMessage, sender: any) => {
    if (msg?.action !== 'open-panel') return;
    const tabId = sender.tab?.id;
    if (tabId == null) return;
    (chrome.sidePanel as any)
      .open({ tabId })
      .catch((e: any) => console.warn('[WalletPair] open-panel failed:', e));
    // No return true: response is sent by the main handler's 'open-panel' case.
  });

  // Handle port connections from content scripts
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'walletpair-content') return;

    const tabId = port.sender?.tab?.id;
    if (tabId !== undefined) contentPorts.set(tabId, port);

    port.onMessage.addListener(async (msg) => {
      if (msg.action === 'rpc-request') {
        const response = await handleRpcRequest(msg.id, msg.payload, msg.origin);
        try {
          port.postMessage({
            action: 'rpc-response',
            id: msg.id,
            method: msg.payload.method,
            ...response,
          });
        } catch {}
      } else if (msg.action === 'get-state') {
        const visibleState = await stateVisibleToSender(port.sender);
        try {
          port.postMessage({ action: 'get-state', state: visibleState });
        } catch {}
      }
    });

    port.onDisconnect.addListener(() => {
      if (tabId !== undefined) contentPorts.delete(tabId);
    });
  });

  // Handle messages from popup and fallback from content scripts
  chrome.runtime.onMessage.addListener((msg: BackgroundMessage, sender, sendResponse) => {
    (async () => { try {
      switch (msg.action) {
        case 'get-state':
          if (sender.tab) {
            sendResponse({ action: 'get-state', state: await stateVisibleToSender(sender) });
          } else {
            sendResponse(state);
          }
          break;

        case 'open-panel':
          // Handled synchronously by the dedicated listener below (which can
          // call sidePanel.open within the forwarded user gesture). Ack here so
          // the message channel closes cleanly.
          sendResponse({ ok: true });
          break;

        case 'start-pairing':
          await createSession();
          sendResponse(state);
          break;

        case 'disconnect':
          // Fix #7: Full cleanup on disconnect
          if (cleanupSessionListeners) {
            cleanupSessionListeners();
            cleanupSessionListeners = null;
          }
          // Reject all pending confirmations
          for (const [cid, pc] of pendingConfirmations) {
            if (pc.timeoutTimer) clearTimeout(pc.timeoutTimer);
            pc.resolve({ error: { code: 4001, message: 'Disconnected' } });
            pendingConfirmations.delete(cid);
          }
          const closingSession = session;
          session = null;
          if (closingSession) await closingSession.closeAndDrain();
          await handleSessionClosed();
          sendResponse({ ok: true });
          break;

        case 'get-pairing-uri':
          sendResponse({ uri: state.pairingUri });
          break;

        case 'rpc-request': {
          const response = await handleRpcRequest(msg.id, msg.payload, msg.origin);
          sendResponse({
            action: 'rpc-response',
            id: msg.id,
            method: msg.payload.method,
            ...response,
          });
          break;
        }

        case 'get-permissions': {
          const perms = await getPermissions();
          sendResponse(perms);
          break;
        }

        case 'revoke-permission': {
          await revokePermission(msg.origin);
          sendResponse({ ok: true });
          break;
        }

        case 'get-confirmation': {
          const pending = pendingConfirmations.get(msg.id);
          if (pending) {
            sendResponse({ method: pending.method, params: pending.params, origin: pending.origin });
          } else {
            sendResponse(null);
          }
          break;
        }

        case 'approve-confirmation': {
          const pending = pendingConfirmations.get(msg.id);
          if (pending) {
            pendingConfirmations.delete(msg.id);
            if (pending.timeoutTimer) clearTimeout(pending.timeoutTimer);
            const response = await forwardToWallet(pending.method, pending.params as unknown[] | Record<string, unknown> | undefined);
            pending.resolve(response);
          }
          sendResponse({ ok: true });
          break;
        }

        case 'reject-confirmation': {
          const pending = pendingConfirmations.get(msg.id);
          if (pending) {
            pendingConfirmations.delete(msg.id);
            if (pending.timeoutTimer) clearTimeout(pending.timeoutTimer);
            pending.resolve({ error: { code: 4001, message: 'User rejected the request' } });
            if (pending.windowId) {
              chrome.windows.remove(pending.windowId).catch((e) => console.warn('[WalletPair]', e));
            }
          }
          sendResponse({ ok: true });
          break;
        }

        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (err) {
      // Fix #6: Catch unhandled errors so sendResponse is always called
      console.error('[WalletPair] Unhandled error in message handler:', err);
      sendResponse({ error: { code: -32603, message: 'Internal error' } });
    } })();
    return true; // Keep channel open for async
  });

  // Handle confirmation popup closed without user action
  chrome.windows.onRemoved.addListener((windowId: number) => {
    for (const [id, pending] of pendingConfirmations) {
      if (pending.windowId === windowId) {
        pendingConfirmations.delete(id);
        if (pending.timeoutTimer) clearTimeout(pending.timeoutTimer);
        pending.resolve({ error: { code: 4001, message: 'User rejected the request' } });
      }
    }
  });

  // Handle keepalive alarm (fires even after SW restart)
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== 'walletpair-keepalive') return;

    if (session?.phase === 'connected') {
      // Check 24-hour session expiry
      const connectedAt = await getConnectedAt();
      if (connectedAt && Date.now() - connectedAt > SESSION_MAX_AGE_MS) {
        cleanupSessionListeners?.();
        cleanupSessionListeners = null;
        const expiredSession = session;
        session = null;
        await expiredSession.closeAndDrain();
        await handleSessionClosed();
        return;
      }
      // This is a persistent backstop. The in-memory 20s timer normally sends
      // the encrypted keepalive before Chrome's service-worker idle deadline.
      session.ping(currentCaip2());
      return;
    }

    // Not connected but the alarm exists, so we *had* a live session. The MV3
    // service worker was likely killed while idle — which silently drops the
    // WebSocket and discards in-memory setTimeout reconnect timers. This
    // persistent alarm is the recovery
    // backstop: rebuild from the saved snapshot and reconnect. tryReconnect is
    // guarded, so this is a no-op if a reconnect is already in flight.
    const saved = await getSessionState();
    if (!saved) return;
    const ok = await tryReconnect();
    if (ok) console.log('[WalletPair] reconnected via keepalive backstop');
  });

  // On SW start, try to restore session
  tryReconnect().then((ok) => {
    if (ok) {
      console.log('[WalletPair] Session restored after SW wake');
      // Alarm is already created in the 'connected' phase handler; no duplicate needed
    }
  });
});
