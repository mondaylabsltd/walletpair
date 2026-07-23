<script lang="ts">
  import type { ActivityEntry } from '@/lib/types';
  import { ChevronDown } from 'lucide-svelte';
  let { entries = [], filterOrigin, onClear }: {
    entries: ActivityEntry[];
    filterOrigin?: string;
    onClear?: () => void;
  } = $props();

  let expandedId = $state<string | null>(null);

  // Filter entries by origin when filterOrigin is provided
  let filteredEntries = $derived(
    filterOrigin
      ? entries.filter(e => {
          try {
            return new URL(e.origin).origin === filterOrigin;
          } catch {
            return e.origin === filterOrigin;
          }
        })
      : entries,
  );

  let filterHostname = $derived(
    filterOrigin ? (() => { try { return new URL(filterOrigin).hostname; } catch { return filterOrigin; } })() : null,
  );

  function relativeTime(ts: number): string {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 5) return 'now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }

  function shortMethod(m: string): string {
    return m.replace('eth_', '').replace('wallet_', '').replace('personal_', '');
  }

  function categoryLabel(c: string): string {
    switch (c) {
      case 'sign': return 'Sign';
      case 'tx': return 'Tx';
      case 'auth': return 'Auth';
      case 'read': return 'Read';
      default: return c;
    }
  }

  function shortOrigin(origin: string): string {
    try { return new URL(origin).hostname; } catch { return origin; }
  }

  function formatJson(value: unknown): string {
    if (value === undefined || value === null) return '—';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function toggleExpand(id: string) {
    expandedId = expandedId === id ? null : id;
  }

  function statusLabel(status: ActivityEntry['status']): string {
    switch (status) {
      case 'pending': return 'Awaiting wallet';
      case 'success': return 'Completed';
      case 'rejected': return 'Rejected';
      case 'error': return 'Failed';
    }
  }
</script>

{#if filteredEntries.length > 0 || (filterOrigin && entries.length > 0)}
  <div class="activity">
    <div class="activity-header">
      <h4 class="activity-title">
        Activity
        {#if filterHostname}
          <span class="filter-badge">{filterHostname}</span>
        {/if}
      </h4>
      {#if onClear && entries.length > 0}
        <button class="clear-btn" onclick={onClear} title="Clear activity log">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          Clear
        </button>
      {/if}
    </div>
    {#if filteredEntries.length === 0}
      <div class="empty-filter">No activity from this site yet</div>
    {:else}
    <div class="activity-list">
      {#each filteredEntries.slice(0, 20) as entry}
        <div class="activity-item">
          <button
            class="activity-row"
            class:expanded={expandedId === entry.id}
            onclick={() => toggleExpand(entry.id)}
            type="button"
            aria-expanded={expandedId === entry.id}
            aria-controls={`activity-detail-${entry.id}`}
          >
            <div class="activity-left">
              <span class="badge {entry.category}">{categoryLabel(entry.category)}</span>
              <span class="method" title={entry.method}>{shortMethod(entry.method)}</span>
            </div>
            <div class="activity-right">
              <span class="origin">{shortOrigin(entry.origin)}</span>
              <span class="status-icon {entry.status}" title={statusLabel(entry.status)}>
                {#if entry.status === 'pending'}●{:else if entry.status === 'success'}✓{:else if entry.status === 'rejected'}✕{:else}!{/if}
              </span>
              <span class="time">{relativeTime(entry.timestamp)}</span>
              <ChevronDown class="chevron" size={14} strokeWidth={1.8} />
            </div>
          </button>
          {#if expandedId === entry.id}
            <div class="detail-panel" id={`activity-detail-${entry.id}`}>
              <div class="detail-grid">
                <div class="detail-field">
                  <span class="detail-label">Method</span>
                  <code class="detail-value">{entry.method}</code>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Status</span>
                  <span class="detail-status {entry.status}">{statusLabel(entry.status)}</span>
                </div>
              </div>
              <div class="detail-field">
                <span class="detail-label">Origin</span>
                <code class="detail-value">{entry.origin}</code>
              </div>
              <div class="detail-field">
                <span class="detail-label">Params</span>
                {#if entry.params !== undefined}
                  <pre class="detail-pre">{formatJson(entry.params)}</pre>
                {:else}
                  <span class="detail-empty">No parameters</span>
                {/if}
              </div>
              {#if entry.status === 'pending'}
                <div class="pending-note">
                  <span class="pending-dot"></span>
                  The request is waiting for a response from the wallet.
                </div>
              {/if}
              {#if entry.result !== undefined}
                <div class="detail-field">
                  <span class="detail-label">Result</span>
                  <pre class="detail-pre result">{formatJson(entry.result)}</pre>
                </div>
              {/if}
              {#if entry.error}
                <div class="detail-field">
                  <span class="detail-label">Error</span>
                  <pre class="detail-pre error">{formatJson(entry.error)}</pre>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
    {/if}
  </div>
{/if}

<style>
  .activity {
    width: 100%;
    margin-top: 2px;
  }

  .activity-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .activity-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
    margin: 0;
    padding: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .filter-badge {
    font-size: 9px;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    color: var(--accent);
    background: var(--accent-dim);
    padding: 1px 6px;
    border-radius: 4px;
  }

  .clear-btn {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    color: var(--text-dimmer);
    background: none;
    border: none;
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
  }
  .clear-btn:hover {
    color: var(--red);
    background: var(--red-dim);
  }

  .empty-filter {
    font-size: 11px;
    color: var(--text-dimmer);
    text-align: center;
    padding: 16px 8px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
  }

  .activity-list {
    max-height: 360px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    border-radius: 14px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-sm);
  }

  .activity-item:not(:last-child) {
    border-bottom: 1px solid var(--border-subtle);
  }

  .activity-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 40px;
    padding: 0 10px;
    font-size: 12px;
    background: none;
    border: none;
    color: inherit;
    width: 100%;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
  }

  .activity-row:hover {
    background: var(--bg-hover);
  }

  .activity-row.expanded {
    background: var(--bg-hover);
  }

  .activity-left {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .activity-right {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-shrink: 0;
  }

  .badge {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 1px 5px;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .badge.read {
    background: var(--neutral-dim);
    color: var(--text-dim);
  }

  .badge.sign {
    background: var(--orange-dim);
    color: var(--orange);
  }

  .badge.tx {
    background: var(--red-dim);
    color: var(--red);
  }

  .badge.auth {
    background: var(--accent-dim);
    color: var(--accent);
  }

  .method {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 11px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .origin {
    font-size: 10px;
    color: var(--text-dimmer);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 80px;
  }

  .status-icon {
    font-size: 11px;
    flex-shrink: 0;
  }

  .status-icon.pending {
    color: var(--orange);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .status-icon.success {
    color: var(--green);
  }

  .status-icon.rejected {
    color: var(--red);
  }

  .status-icon.error {
    color: var(--red);
  }

  .time {
    font-size: 10px;
    color: var(--text-dimmer);
    white-space: nowrap;
    min-width: 32px;
    text-align: right;
  }

  :global(.chevron) {
    color: var(--text-dimmer);
    flex-shrink: 0;
    transition: transform 0.16s ease;
  }

  .activity-row.expanded :global(.chevron) {
    transform: rotate(180deg);
  }

  /* Detail panel */
  .detail-panel {
    padding: 12px;
    background: var(--bg-soft);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
  }

  .detail-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .detail-label {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
  }

  .detail-value {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 11px;
    color: var(--text);
    word-break: break-all;
  }

  .detail-pre {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 10px;
    color: var(--text-dim);
    margin: 0;
    padding: 6px 8px;
    border-radius: 4px;
    background: var(--code-bg);
    border: 1px solid var(--border);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 120px;
    overflow-y: auto;
  }

  .detail-empty {
    color: var(--text-dimmer);
    font-size: 11px;
  }

  .detail-status {
    font-size: 11px;
    font-weight: 600;
  }

  .detail-status.pending { color: var(--orange); }
  .detail-status.success { color: var(--green); }
  .detail-status.rejected,
  .detail-status.error { color: var(--red); }

  .pending-note {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--orange-dim);
    color: var(--orange);
    font-size: 11px;
    line-height: 1.4;
  }

  .pending-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--orange);
    flex-shrink: 0;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .detail-pre.result {
    border-left: 2px solid var(--green);
  }

  .detail-pre.error {
    border-left: 2px solid var(--red);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>
