<script lang="ts">
  import type { ActivityEntry } from '@/lib/types';

  let { entries = [] }: { entries: ActivityEntry[] } = $props();

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
</script>

{#if entries.length > 0}
  <div class="activity">
    <h4 class="activity-title">Activity</h4>
    <div class="activity-list">
      {#each entries.slice(0, 20) as entry}
        <div class="activity-row">
          <div class="activity-left">
            <span class="badge {entry.category}">{categoryLabel(entry.category)}</span>
            <span class="method">{shortMethod(entry.method)}</span>
          </div>
          <div class="activity-right">
            <span class="origin">{shortOrigin(entry.origin)}</span>
            <span class="status-icon {entry.status}">
              {#if entry.status === 'pending'}●{:else if entry.status === 'success'}✓{:else if entry.status === 'rejected'}✕{:else}!{/if}
            </span>
            <span class="time">{relativeTime(entry.timestamp)}</span>
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .activity {
    width: 100%;
    margin-top: 8px;
  }

  .activity-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dimmer);
    margin: 0 0 6px 0;
    padding: 0;
  }

  .activity-list {
    max-height: 200px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
    border-radius: 8px;
    background: var(--bg-card);
    border: 1px solid var(--border);
  }

  .activity-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 28px;
    padding: 0 8px;
    font-size: 12px;
  }

  .activity-row:not(:last-child) {
    border-bottom: 1px solid var(--border);
  }

  .activity-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .activity-right {
    display: flex;
    align-items: center;
    gap: 6px;
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
    background: rgba(128, 128, 128, 0.12);
    color: var(--text-dimmer);
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
    color: var(--text-dim);
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

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>
