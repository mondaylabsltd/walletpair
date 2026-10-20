/**
 * The extension's DApp side of WalletPair: owns the session with the Wallet
 * (lib/background/session.ts), answers page providers (lib/background/router.ts)
 * and keeps the side panel informed.
 */
import { browser, type Browser } from 'wxt/browser';
import { connect, Room } from '../../vendor/peerconnect/index.js';
import { SessionManager, type PeerRoom } from '@/lib/background/session';
import { Router } from '@/lib/background/router';
import { NAMESPACES } from '@/lib/constants';
import { evmProxyRpcCall } from '@/lib/evm/rpc-proxy';
import {
  addActivityEntry,
  clearSites,
  getClosingRooms,
  getPendingIds,
  getRoom,
  getSessionCache,
  getSettings,
  getSites,
  grantSite,
  revokeSite,
  saveRoom,
  savePendingIds,
  saveSessionCache,
  setClosingRoom,
  updateActivity,
} from '@/lib/storage';
import type { BackgroundMessage, ContentMessage, ExtensionState, UiMessage } from '@/lib/types';
import { CallError } from '@/lib/walletpair/client';
import { ErrorCode, rpcError, type RpcError } from '@/lib/walletpair/protocol';

export default defineBackground(() => {
  const session = new SessionManager({
    peer: {
      create: (relay) => Room.create(relay),
      parse: (record) => Room.parse(record),
      connect: (room: PeerRoom) => connect(room as Room),
    },
    relayUrl: async () => (await getSettings()).relayUrl,
    store: {
      getRoom,
      saveRoom,
      getClosingRooms,
      setClosingRoom,
      getSessionCache,
      saveSessionCache,
      getPendingIds,
      savePendingIds,
      clearSites,
    },
  });

  const router = new Router({
    session,
    sites: { getSites, grantSite, revokeSite },
    activity: { add: addActivityEntry, update: updateActivity },
    rpc: async (chain, method, params) =>
      evmProxyRpcCall(chain.slice('eip155:'.length), method, params, (await getSettings()).rpcUrls),
    surface: () => void updateBadge(true),
  });

  // ── Pages ──

  interface Page {
    id: number;
    origin: string;
  }
  const pages = new Map<Browser.runtime.Port, Page>();
  let nextPage = 1;

  function senderOrigin(sender: Browser.runtime.MessageSender | undefined): string | undefined {
    const raw = sender?.origin ?? sender?.url;
    if (!raw) return undefined;
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined;
    } catch {
      return undefined;
    }
  }

  function post(port: Browser.runtime.Port, message: BackgroundMessage): void {
    try {
      port.postMessage(message);
    } catch {
      // The page went away.
    }
  }

  async function sendState(port: Browser.runtime.Port): Promise<void> {
    const page = pages.get(port);
    if (page) post(port, { kind: 'state', state: await router.siteState(page.origin), live: router.live });
  }

  function broadcastState(): void {
    for (const port of pages.keys()) void sendState(port);
  }

  function toRpcError(error: unknown): RpcError {
    if (error instanceof CallError) return rpcError(error.code, error.message, error.data);
    return rpcError(ErrorCode.Internal, error instanceof Error ? error.message : 'Internal error');
  }

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === 'walletpair-ui') {
      // Only the extension's own pages may watch the session; content scripts share its id, not its origin.
      if (!port.sender?.url?.startsWith(browser.runtime.getURL('/'))) return port.disconnect();
      uiPorts.add(port);
      port.onDisconnect.addListener(() => uiPorts.delete(port));
      void session.restore().then(uiState).then((state) => post(port, { state } as never));
      return;
    }
    if (port.name !== 'walletpair-content') return;
    const origin = senderOrigin(port.sender);
    if (!origin) {
      port.disconnect();
      return;
    }
    const page: Page = { id: nextPage++, origin };
    pages.set(port, page);
    port.onMessage.addListener(async (message: ContentMessage) => {
      await session.restore();
      if (message.kind === 'hello') return sendState(port);
      if (message.kind !== 'call') return;
      try {
        const result = await router.handle(message.call, origin, page.id);
        post(port, { kind: 'result', id: message.id, result: result ?? null });
      } catch (error) {
        post(port, { kind: 'result', id: message.id, error: toRpcError(error) });
      }
    });
    port.onDisconnect.addListener(() => {
      pages.delete(port);
      router.closeTab(page.id);
    });
  });

  session.addEventListener('state', broadcastState);
  router.addEventListener('sites', broadcastState);

  // ── Side panel ──

  async function uiState(): Promise<ExtensionState> {
    const sites = Object.entries(await getSites()).map(([origin, namespaces]) => ({ origin, namespaces }));
    return {
      phase: session.phase,
      uri: session.uri,
      online: session.online,
      replaced: session.replaced,
      wallet: session.wallet,
      state: session.state,
      declined: session.declined,
      sites,
      approvals: router.approvals,
      pending: router.pending,
    };
  }

  const uiPorts = new Set<Browser.runtime.Port>();

  async function broadcastUi(): Promise<void> {
    void updateBadge(false);
    if (!uiPorts.size) return;
    const state = await uiState();
    for (const port of uiPorts) post(port, { state } as never);
  }

  /** A badge on the toolbar icon while the user has something to do in the panel. */
  async function updateBadge(attention: boolean): Promise<void> {
    const needed = attention || router.approvals.length > 0 || session.phase === 'pairing';
    await browser.action?.setBadgeText({ text: needed ? '!' : '' }).catch(() => {});
    if (needed) await browser.action?.setBadgeBackgroundColor({ color: '#2563eb' }).catch(() => {});
  }

  session.addEventListener('change', broadcastUi);
  router.addEventListener('change', broadcastUi);
  router.addEventListener('sites', broadcastUi);

  browser.runtime.onMessage.addListener((message: UiMessage, sender, respond) => {
    if (message.action === 'open-panel') {
      // Sent synchronously from a page's click, so the user gesture still counts.
      const tabId = sender.tab?.id;
      if (tabId !== undefined) browser.sidePanel?.open({ tabId }).catch(() => {});
      return false;
    }
    void (async () => {
      try {
        await handleUi(message);
        respond(await uiState());
      } catch (error) {
        console.error('[WalletPair]', error);
        respond({ ...(await uiState().catch(() => ({}))), error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  });

  async function handleUi(message: UiMessage): Promise<void> {
    await session.restore();
    switch (message.action) {
      case 'pair':
        return session.pair();
      case 'reconnect':
        // A declined connection is reported through the state, not as a failure.
        await session.ask(NAMESPACES).catch(() => {});
        return;
      case 'disconnect':
        return session.end();
      case 'approve-site':
        return router.approve(message.id, message.allow);
      case 'revoke-site':
        return router.revokeSite(message.origin);
    }
  }

  // Chrome opens the side panel from the toolbar icon; Firefox shows the popup.
  browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  // ── Lifetime ──
  // The PeerConnect connection's keepalive keeps the service worker running
  // while a session exists. When the browser stops it anyway, any event wakes
  // it, and the session comes back from storage.
  browser.runtime.onStartup.addListener(() => void session.restore());
  browser.alarms.create('walletpair-restore', { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'walletpair-restore') void session.restore();
  });
  void session.restore();
});
