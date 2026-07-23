<div class="diagram-wrap">
	<div class="diagram-header">
		<span class="dot red"></span>
		<span class="dot yellow"></span>
		<span class="dot green"></span>
		<span class="diagram-title">protocol flow</span>
	</div>
	<pre class="diagram"><code
			>{` dApp                          Relay                         Wallet
  │                              │                              │
  │── connect /v1 (metadata) ──>│                              │
  │<─ channel_joined (self) ────│                              │
  │                              │                              │
  │   ┌─────────────────────────────────────────────────────┐   │
  │   │ dApp displays QR + code · wallet scans and compares │   │
  │   └─────────────────────────────────────────────────────┘   │
  │                              │                              │
  │                              │ <── connect /v1 (metadata) ──│
  │<─ channel_joined (wallet) ── │ ──> channel_joined (wallet) ─│
  │                              │                              │
  │   ┌─────────────────────────────────────────────────────┐   │
  │   │  Derive directional traffic keys and pin peer key    │   │
  │   └─────────────────────────────────────────────────────┘   │
  │                              │                              │
  │── sealed@eip155:1 ─────────>│ ─── sealed@eip155:1 ─────────>│
  │                              │ <─── sealed@eip155:1 ─────────│
  │<─ sealed@eip155:1 ──────────│                              │`}</code
		></pre>
</div>

<style>
	.diagram-wrap {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	.diagram-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface-2);
		border-bottom: 1px solid var(--color-border);
	}

	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}

	.dot.red {
		background: #ff5f57;
	}
	.dot.yellow {
		background: #febc2e;
	}
	.dot.green {
		background: #28c840;
	}

	.diagram-title {
		margin-left: var(--space-2);
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--color-text-subtle);
	}

	.diagram {
		padding: var(--space-6);
		margin: 0;
		overflow-x: auto;
		background: none;
		border: none;
		border-radius: 0;
	}

	.diagram code {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--color-text-muted);
		white-space: pre;
	}
</style>
