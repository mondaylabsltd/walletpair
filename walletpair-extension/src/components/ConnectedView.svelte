<script lang="ts">
  import type { ConnectedWallet, ActivityEntry } from '@/lib/types';
  import ActivityLog from './ActivityLog.svelte';
  import SigningToast from './SigningToast.svelte';
  import { getActivityLog, clearActivityLog } from '@/lib/storage';
  import { Copy, Check } from 'lucide-svelte';

  let {
    wallet,
    onDisconnect,
    signingInProgress,
  }: {
    wallet?: ConnectedWallet | null;
    onDisconnect: () => void;
    signingInProgress?: { method: string; origin: string };
  } = $props();

  let activity = $state<ActivityEntry[]>([]);
  let currentOrigin = $state<string | undefined>(undefined);

  function updateCurrentOrigin() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url;
      if (url) {
        try { currentOrigin = new URL(url).origin; } catch { /* ignore */ }
      }
    });
  }

  $effect(() => {
    updateCurrentOrigin();

    // Re-query origin when user switches tabs or windows
    const onTabActivated = () => updateCurrentOrigin();
    const onWindowFocused = (windowId: number) => {
      if (windowId !== chrome.windows.WINDOW_ID_NONE) updateCurrentOrigin();
    };
    // Also catches in-tab navigations (e.g. SPA route changes)
    const onTabUpdated = (_tabId: number, info: { url?: string }) => {
      if (info.url) updateCurrentOrigin();
    };

    chrome.tabs.onActivated.addListener(onTabActivated);
    chrome.windows.onFocusChanged.addListener(onWindowFocused);
    chrome.tabs.onUpdated.addListener(onTabUpdated);

    const load = () => getActivityLog().then(a => { activity = a; });
    load();
    const timer = setInterval(load, 2000);

    return () => {
      clearInterval(timer);
      chrome.tabs.onActivated.removeListener(onTabActivated);
      chrome.windows.onFocusChanged.removeListener(onWindowFocused);
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
    };
  });

  async function handleClearActivity() {
    await clearActivityLog();
    activity = [];
  }

  let address = $derived(wallet?.address ?? '');
  let shortAddress = $derived(
    address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Unknown',
  );
  let chainName = $derived(getChainName(wallet?.chainId ?? 1));
  let copied = $state(false);

  function getChainName(id: number): string {
    const chains: Record<number, string> = {
      1: 'Ethereum',
      10: 'Optimism',
      56: 'BNB Chain',
      100: 'Gnosis',
      137: 'Polygon',
      42161: 'Arbitrum',
      8453: 'Base',
      43114: 'Avalanche',
      250: 'Fantom',
    };
    return chains[id] ?? `Chain ${id}`;
  }

  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<div class="connected">
  <div class="wallet-card">
    <div class="wallet-avatar">
      {#if wallet?.icon}
        <img src={wallet.icon} alt="" class="wallet-icon" />
      {:else}
        <div class="avatar-fallback">
          {address ? address.slice(2, 4).toUpperCase() : 'WP'}
        </div>
      {/if}
    </div>

    <div class="wallet-info">
      <div class="wallet-heading">
        <span class="wallet-name">{wallet?.name || 'Wallet'}</span>
        <span class="status-badge green">
          <span class="status-dot green"></span>
          Connected
        </span>
      </div>
      <button class="address-btn" onclick={copyAddress} title="Copy address">
        <span class="address">{shortAddress}</span>
        {#if copied}
          <Check size={12} strokeWidth={2} color="var(--green)" />
        {:else}
          <Copy size={12} strokeWidth={1.5} />
        {/if}
      </button>
    </div>

    <div class="chain-badge">{chainName}</div>
  </div>

  <SigningToast method={signingInProgress?.method} origin={signingInProgress?.origin} />
  <ActivityLog entries={activity} filterOrigin={currentOrigin} onClear={handleClearActivity} />

  <div class="actions">
    <button class="btn-disconnect" onclick={onDisconnect}>Disconnect</button>
  </div>
</div>

<style>
  .connected {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    animation: fadeInScale 0.3s ease-out;
  }

  .status-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    font-weight: 600;
    padding: 3px 7px;
    border-radius: 100px;
  }
  .status-badge.green {
    background: var(--green-dim);
    color: var(--green);
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .status-dot.green {
    background: var(--green);
  }

  .wallet-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 16px;
    width: 100%;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 12px;
    box-shadow: var(--shadow-card);
  }

  .wallet-avatar {
    width: 46px;
    height: 46px;
    border-radius: 14px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .wallet-icon {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-dim);
    color: var(--accent);
    font-weight: 700;
    font-size: 16px;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }

  .wallet-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    min-width: 0;
    flex: 1;
  }

  .wallet-heading {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .wallet-name {
    font-size: 15px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .address-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: none;
    padding: 2px 0;
    color: var(--text-dim);
  }

  .address {
    font-size: 12px;
    color: var(--text-dim);
    font-family: 'SF Mono', 'Fira Code', monospace;
  }

  .chain-badge {
    font-size: 11px;
    font-weight: 500;
    color: var(--accent-hover);
    background: var(--accent-dim);
    padding: 4px 10px;
    border-radius: 100px;
    flex-shrink: 0;
  }

  .actions {
    width: 100%;
    padding-top: 2px;
  }

  .btn-disconnect {
    width: 100%;
    background: transparent;
    color: var(--text-dim);
    font-size: 13px;
    font-weight: 500;
    padding: 10px 24px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
  }
  .btn-disconnect:hover {
    color: var(--red);
    border-color: var(--red);
    background: var(--red-dim);
  }

  .address-btn:hover {
    color: var(--accent);
  }

  @keyframes fadeInScale {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }
</style>
