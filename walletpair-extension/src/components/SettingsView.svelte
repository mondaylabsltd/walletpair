<script lang="ts">
  import { getSettings, saveSettings } from '@/lib/storage';
  import { DEFAULT_RELAY_URL } from '@/lib/constants';

  let { onBack }: { onBack: () => void } = $props();

  let relayUrl = $state(DEFAULT_RELAY_URL);
  let saved = $state(false);

  $effect(() => {
    getSettings().then((s) => {
      relayUrl = s.relayUrl;
    });
  });

  async function save() {
    await saveSettings({ relayUrl });
    saved = true;
    setTimeout(() => (saved = false), 2000);
  }

  function resetRelay() {
    relayUrl = DEFAULT_RELAY_URL;
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
    <div class="info-card">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="var(--accent)" style="flex-shrink: 0; margin-top: 1px;">
        <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 3.75a.75.75 0 011.5 0v.5a.75.75 0 01-1.5 0v-.5zM8 7a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 7z"/>
      </svg>
      <p>WalletPair is a transparent bridge. Signing and transaction confirmations happen in your wallet, not here.</p>
    </div>

    <section class="section">
      <h3 class="section-label">Relay Server</h3>
      <input
        type="url"
        class="input"
        bind:value={relayUrl}
        placeholder="wss://relay.walletpair.org/v1"
      />
      {#if relayUrl !== DEFAULT_RELAY_URL}
        <button class="btn-reset" onclick={resetRelay}>Reset to default</button>
      {/if}
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
    padding: 6px;
    border-radius: 8px;
    display: flex;
    align-items: center;
  }
  .back-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .settings-title {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .info-card {
    display: flex;
    gap: 10px;
    padding: 10px 14px;
    background: var(--accent-dim);
    border: 1px solid rgba(99, 102, 241, 0.12);
    border-radius: 10px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-dim);
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
    gap: 8px;
  }

  .section-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
  }

  .input {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 14px;
    font-size: 12px;
    color: var(--text);
    font-family: 'SF Mono', 'Fira Code', monospace;
    outline: none;
    width: 100%;
  }
  .input:focus {
    border-color: var(--accent);
  }

  .btn-reset {
    background: none;
    color: var(--text-dimmer);
    font-size: 11px;
    padding: 0;
    text-align: left;
  }
  .btn-reset:hover {
    color: var(--accent);
  }

  .btn-save {
    background: var(--accent);
    color: white;
    font-size: 13px;
    font-weight: 600;
    padding: 12px 20px;
    border-radius: 10px;
    width: 100%;
    margin-top: auto;
    box-shadow: 0 2px 10px rgba(99, 102, 241, 0.2);
  }
  .btn-save:hover {
    background: var(--accent-hover);
    box-shadow: 0 4px 16px rgba(99, 102, 241, 0.3);
  }
</style>
