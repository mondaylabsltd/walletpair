<script lang="ts">
  import { hostOf, methodName } from '@/lib/display';

  let { method = '', origin = '' }: { method?: string; origin?: string } = $props();
</script>

{#if method}
  <div class="toast">
    <span class="toast-dot"></span>
    <span class="toast-text">
      <strong>{methodName(method)}</strong> · {hostOf(origin)} · confirm in wallet
    </span>
  </div>
{/if}

<style>
  .toast {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 32px;
    padding: 0 12px;
    border-radius: 8px;
    background: var(--orange-dim);
    border: 1px solid rgba(245, 158, 11, 0.2);
    font-size: 12px;
    color: var(--text);
    animation: slideIn 0.2s ease-out;
  }

  .toast-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--orange);
    flex-shrink: 0;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .toast-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .toast-text strong {
    font-weight: 600;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  @keyframes slideIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
