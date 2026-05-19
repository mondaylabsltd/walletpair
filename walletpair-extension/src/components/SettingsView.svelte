<script lang="ts">
  import { getSettings, saveSettings } from '@/lib/storage';
  import { DEFAULT_RELAY_URL } from '@/lib/constants';

  let { onBack }: { onBack: () => void } = $props();

  let relayUrl = $state(DEFAULT_RELAY_URL);
  let autoConnect = $state(true);
  let saved = $state(false);

  const CHAINS = [
    { id: 'eip155:1', name: 'Ethereum', icon: 'ETH' },
    { id: 'eip155:137', name: 'Polygon', icon: 'MATIC' },
    { id: 'eip155:42161', name: 'Arbitrum', icon: 'ARB' },
    { id: 'eip155:10', name: 'Optimism', icon: 'OP' },
    { id: 'eip155:8453', name: 'Base', icon: 'BASE' },
    { id: 'eip155:56', name: 'BNB Chain', icon: 'BNB' },
    { id: 'eip155:43114', name: 'Avalanche', icon: 'AVAX' },
  ];

  let enabledChains = $state<string[]>([]);

  $effect(() => {
    getSettings().then((s) => {
      relayUrl = s.relayUrl;
      autoConnect = s.autoConnect;
      enabledChains = [...s.enabledChains];
    });
  });

  function toggleChain(chainId: string) {
    if (enabledChains.includes(chainId)) {
      enabledChains = enabledChains.filter((c) => c !== chainId);
    } else {
      enabledChains = [...enabledChains, chainId];
    }
  }

  async function save() {
    await saveSettings({ relayUrl, autoConnect, enabledChains });
    saved = true;
    setTimeout(() => (saved = false), 2000);
  }
</script>

<div class="settings">
  <div class="settings-header">
    <button class="back-btn" onclick={onBack} aria-label="Back">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
        <path d="M7.78 12.53a.75.75 0 01-1.06 0L2.47 8.28a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L4.56 7.25h8.69a.75.75 0 010 1.5H4.56l3.22 3.22a.75.75 0 010 1.06z"/>
      </svg>
    </button>
    <span class="settings-title">Settings</span>
  </div>

  <div class="settings-body">
    <section class="section">
      <h3 class="section-label">Relay Server</h3>
      <input
        type="url"
        class="input"
        bind:value={relayUrl}
        placeholder="wss://relay.walletpair.org/v1"
      />
    </section>

    <section class="section">
      <label class="toggle-row">
        <span>Auto-reconnect</span>
        <input type="checkbox" bind:checked={autoConnect} class="toggle" />
      </label>
    </section>

    <section class="section">
      <h3 class="section-label">Chains</h3>
      <div class="chain-grid">
        {#each CHAINS as chain}
          <button
            class="chain-chip"
            class:active={enabledChains.includes(chain.id)}
            onclick={() => toggleChain(chain.id)}
          >
            <span class="chip-icon">{chain.icon}</span>
            <span class="chip-name">{chain.name}</span>
          </button>
        {/each}
      </div>
    </section>

    <button class="btn-save" onclick={save}>
      {saved ? 'Saved!' : 'Save'}
    </button>
  </div>
</div>

<style>
  .settings {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .settings-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 16px;
  }

  .back-btn {
    background: none;
    color: var(--text-dim);
    padding: 4px;
    border-radius: 6px;
    display: flex;
    align-items: center;
  }
  .back-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .settings-title {
    font-size: 14px;
    font-weight: 600;
  }

  .settings-body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    flex: 1;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .section-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dimmer);
  }

  .input {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 8px 12px;
    font-size: 12px;
    color: var(--text);
    font-family: 'SF Mono', 'Fira Code', monospace;
    outline: none;
    width: 100%;
  }
  .input:focus {
    border-color: var(--accent);
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 13px;
    cursor: pointer;
  }

  .toggle {
    width: 34px;
    height: 18px;
    appearance: none;
    background: var(--border);
    border-radius: 9px;
    position: relative;
    cursor: pointer;
    transition: background 0.2s;
    flex-shrink: 0;
  }
  .toggle::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    background: white;
    border-radius: 50%;
    transition: transform 0.2s;
  }
  .toggle:checked {
    background: var(--accent);
  }
  .toggle:checked::after {
    transform: translateX(16px);
  }

  .chain-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chain-chip {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 100px;
    color: var(--text-dim);
    font-size: 12px;
  }
  .chain-chip:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .chain-chip.active {
    border-color: var(--accent);
    background: var(--accent-dim);
    color: var(--accent-hover);
  }

  .chip-icon {
    font-size: 10px;
    font-weight: 700;
    font-family: 'SF Mono', 'Fira Code', monospace;
    opacity: 0.7;
  }

  .chip-name {
    font-weight: 500;
  }

  .btn-save {
    background: var(--accent);
    color: white;
    font-size: 13px;
    font-weight: 500;
    padding: 10px 20px;
    border-radius: var(--radius-sm);
    width: 100%;
    margin-top: auto;
  }
  .btn-save:hover {
    background: var(--accent-hover);
  }
</style>
