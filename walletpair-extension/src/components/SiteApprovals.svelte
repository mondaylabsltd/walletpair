<script lang="ts">
  import { sendToBackground } from '@/lib/messaging';
  import { hostOf, NAMESPACE_NAMES } from '@/lib/display';
  import type { SiteApproval } from '@/lib/types';

  let { approvals }: { approvals: SiteApproval[] } = $props();

  function answer(id: string, allow: boolean) {
    sendToBackground({ action: 'approve-site', id, allow });
  }
</script>

{#each approvals as approval (approval.id)}
  <div class="approval">
    <p class="text">
      <strong title={approval.origin}>{hostOf(approval.origin)}</strong>
      wants to use your {NAMESPACE_NAMES[approval.namespace] ?? approval.namespace} accounts.
    </p>
    <div class="buttons">
      <button class="deny" onclick={() => answer(approval.id, false)}>Deny</button>
      <button class="allow" onclick={() => answer(approval.id, true)}>Allow</button>
    </div>
  </div>
{/each}

<style>
  .approval {
    width: 100%;
    background: var(--accent-dim);
    border: 1px solid rgba(37, 99, 235, 0.2);
    border-radius: var(--radius-sm);
    padding: 12px;
    margin-bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .text {
    font-size: 13px;
    line-height: 1.5;
  }

  .buttons {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .buttons button {
    font-size: 13px;
    font-weight: 600;
    padding: 7px 16px;
    border-radius: var(--radius-sm);
  }

  .allow {
    background: var(--accent);
    color: white;
  }

  .deny {
    background: var(--bg-card);
    color: var(--text);
    border: 1px solid var(--border);
  }
</style>
