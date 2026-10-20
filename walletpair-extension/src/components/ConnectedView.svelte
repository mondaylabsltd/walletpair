<script lang="ts">
  import type { ActivityEntry, ExtensionState } from '@/lib/types';
  import ActivityLog from './ActivityLog.svelte';
  import SigningToast from './SigningToast.svelte';
  import { clearActivityLog, getActivityLog } from '@/lib/storage';
  import { sendToBackground } from '@/lib/messaging';
  import { chainName, hostOf, NAMESPACE_NAMES, shortAddress } from '@/lib/display';
  import { Copy, Check, X } from 'lucide-svelte';

  let { ext, onDisconnect }: { ext: ExtensionState; onDisconnect: () => void } = $props();

  let activity = $state<ActivityEntry[]>([]);
  let currentOrigin = $state<string | undefined>(undefined);
  let copied = $state<string | undefined>(undefined);

  function updateCurrentOrigin() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url;
      if (!url) return;
      try {
        currentOrigin = new URL(url).origin;
      } catch {
        // Not a web page.
      }
    });
  }

  $effect(() => {
    updateCurrentOrigin();
    const onTabActivated = () => updateCurrentOrigin();
    const onWindowFocused = (windowId: number) => {
      if (windowId !== chrome.windows.WINDOW_ID_NONE) updateCurrentOrigin();
    };
    const onTabUpdated = (_tabId: number, info: { url?: string }) => {
      if (info.url) updateCurrentOrigin();
    };
    chrome.tabs.onActivated.addListener(onTabActivated);
    chrome.windows?.onFocusChanged.addListener(onWindowFocused);
    chrome.tabs.onUpdated.addListener(onTabUpdated);

    const load = () => getActivityLog().then((a) => (activity = a));
    load();
    const timer = setInterval(load, 2000);
    return () => {
      clearInterval(timer);
      chrome.tabs.onActivated.removeListener(onTabActivated);
      chrome.windows?.onFocusChanged.removeListener(onWindowFocused);
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
    };
  });

  let networks = $derived(Object.entries(ext.state));

  async function clearActivity() {
    await clearActivityLog();
    activity = [];
  }

  function copy(address: string) {
    navigator.clipboard.writeText(address);
    copied = address;
    setTimeout(() => (copied = undefined), 2000);
  }

  function revoke(origin: string) {
    sendToBackground({ action: 'revoke-site', origin });
  }
</script>

<div class="connected">
  <div class="wallet-card">
    <div class="wallet-avatar">
      {#if ext.wallet?.icon}
        <img src={ext.wallet.icon} alt="" class="wallet-icon" />
      {:else}
        <div class="avatar-fallback">{(ext.wallet?.name ?? 'W').slice(0, 1).toUpperCase()}</div>
      {/if}
    </div>
    <div class="wallet-info">
      <div class="wallet-heading">
        <span class="wallet-name">{ext.wallet?.name ?? 'Wallet'}</span>
        {#if ext.online}
          <span class="status-badge green"><span class="status-dot green"></span>Online</span>
        {:else}
          <span class="status-badge orange"><span class="status-dot orange"></span>Offline</span>
        {/if}
      </div>
      {#if ext.replaced}
        <span class="note">This session is open in another browser.</span>
      {:else if !ext.online}
        <span class="note">Requests are delivered when the wallet is back.</span>
      {/if}
    </div>
  </div>

  <div class="networks">
    {#each networks as [namespace, value] (namespace)}
      <div class="network-row">
        <span class="network-name">{NAMESPACE_NAMES[namespace] ?? namespace}</span>
        <span class="chain-badge">{chainName(value.chain)}</span>
        <button class="address-btn" onclick={() => copy(value.accounts[0])} title="Copy address">
          <span class="address">{shortAddress(value.accounts[0])}</span>
          {#if copied === value.accounts[0]}
            <Check size={12} strokeWidth={2} color="var(--green)" />
          {:else}
            <Copy size={12} strokeWidth={1.5} />
          {/if}
        </button>
      </div>
    {/each}
  </div>

  {#each ext.pending as call (call.id)}
    <SigningToast method={call.method} origin={call.origin} />
  {/each}

  {#if ext.sites.length}
    <div class="sites">
      <h4 class="sites-title">Connected sites</h4>
      {#each ext.sites as site (site.origin)}
        <div class="site-row">
          <span class="site-host" title={site.origin}>{hostOf(site.origin)}</span>
          <span class="site-namespaces">{site.namespaces.map((ns) => NAMESPACE_NAMES[ns] ?? ns).join(' · ')}</span>
          <button class="site-revoke" onclick={() => revoke(site.origin)} title="Disconnect this site">
            <X size={13} strokeWidth={1.8} />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <ActivityLog entries={activity} filterOrigin={currentOrigin} onClear={clearActivity} />

  <div class="actions">
    <button class="btn-disconnect" onclick={onDisconnect}>Disconnect wallet</button>
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


  .status-badge.orange {
    background: var(--orange-dim);
    color: var(--orange);
  }
  .status-dot.orange {
    background: var(--orange);
  }

  .note {
    font-size: 11px;
    color: var(--text-dim);
  }

  .networks,
  .sites {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .network-row,
  .site-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
  }

  .network-name {
    font-size: 12px;
    font-weight: 600;
    width: 52px;
    flex-shrink: 0;
  }

  .network-row .address-btn {
    margin-left: auto;
  }

  .sites-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
  }

  .site-host {
    font-size: 12px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .site-namespaces {
    font-size: 11px;
    color: var(--text-dim);
    margin-left: auto;
    flex-shrink: 0;
  }

  .site-revoke {
    background: none;
    color: var(--text-dim);
    padding: 2px;
    display: flex;
  }
  .site-revoke:hover {
    color: var(--red);
  }

  @keyframes fadeInScale {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }
</style>
