<script lang="ts">
	import PlaygroundDApp from '$lib/playground/PlaygroundDApp.svelte';
	import PlaygroundWallet from '$lib/playground/PlaygroundWallet.svelte';
	import { playground } from '$lib/playground/state.svelte';

	let width = $state(0);
	const isMobile = $derived(width < 768);
</script>

<svelte:head>
	<title>Playground — WalletPair</title>
</svelte:head>

<svelte:window bind:innerWidth={width} />

<div class="playground-wrap">
	<div class="playground-header">
		<h1>Playground</h1>
		<p>
			Pair the two demo panels in three short steps. The EVM requests travel in encrypted WalletPair
			frames, but you only need to make the choices that matter.
		</p>
	</div>

	<ol class="steps" aria-label="Playground steps">
		<li>
			<span>1</span>
			<div><strong>Create a QR</strong><small>Start in the dApp panel</small></div>
		</li>
		<li>
			<span>2</span>
			<div><strong>Verify the code</strong><small>Join from the Wallet panel</small></div>
		</li>
		<li>
			<span>3</span>
			<div>
				<strong>Try a request</strong><small>Send EIP-1193 over <code>eip155:1</code></small>
			</div>
		</li>
	</ol>

	<div class="protocol-note">
		<span class="mode-dot"></span><strong>Same-page demo</strong><span
			>dApp + Wallet run together</span
		><span>End-to-end encrypted</span><code>eip155:1</code>
	</div>

	{#if isMobile}
		<!-- Mobile: tabbed view -->
		<div class="tabs">
			<button
				class="tab"
				class:active={playground.activeTab === 'dapp'}
				onclick={() => (playground.activeTab = 'dapp')}
			>
				dApp
			</button>
			<button
				class="tab"
				class:active={playground.activeTab === 'wallet'}
				onclick={() => (playground.activeTab = 'wallet')}
			>
				Wallet
			</button>
		</div>
	{/if}

	<!-- Both roles remain mounted so a mobile tab switch never loses a live pairing. -->
	<div class="session-panels">
		<div class="session-panel" hidden={isMobile && playground.activeTab !== 'dapp'}>
			<PlaygroundDApp />
		</div>
		<div class="session-panel" hidden={isMobile && playground.activeTab !== 'wallet'}>
			<PlaygroundWallet />
		</div>
	</div>
</div>

<style>
	.playground-wrap {
		max-width: var(--max-w-playground);
		margin: 0 auto;
		padding: var(--space-8) var(--space-6);
	}

	.playground-header {
		margin-bottom: var(--space-4);
	}

	.playground-header h1 {
		font-family: var(--font-mono);
		font-size: 1.5rem;
		font-weight: 600;
		margin-bottom: var(--space-2);
	}

	.playground-header p {
		color: var(--color-text-muted);
		font-size: 0.9rem;
		max-width: 600px;
	}

	.steps {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-2);
		padding: 0;
		margin: 0 0 var(--space-3);
		list-style: none;
	}

	.steps li {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.steps li > span {
		display: grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		background: var(--color-surface-2);
		color: var(--color-accent);
		font: 600 0.75rem var(--font-mono);
		flex: 0 0 auto;
	}

	.steps strong,
	.steps small {
		display: block;
	}

	.steps strong {
		font-size: 0.82rem;
	}

	.steps small {
		margin-top: 2px;
		color: var(--color-text-muted);
		font-size: 0.72rem;
	}

	.protocol-note {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
		color: var(--color-text-muted);
		font: 0.72rem var(--font-mono);
	}

	.mode-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-success);
		flex-shrink: 0;
	}

	@media (max-width: 640px) {
		.steps {
			grid-template-columns: 1fr;
		}

		.steps li {
			padding: var(--space-2) var(--space-3);
		}
	}

	/* ── Session panels ── */
	.session-panels {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-4);
		align-items: start;
	}

	/* ── Tabs (mobile) ── */
	.tabs {
		display: flex;
		gap: 2px;
		margin-bottom: var(--space-4);
		background: var(--color-surface);
		border-radius: var(--radius-md);
		padding: 2px;
		border: 1px solid var(--color-border);
	}

	.tab {
		flex: 1;
		padding: var(--space-2) var(--space-4);
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: 0.85rem;
		border-radius: var(--radius-sm);
		transition:
			background 0.15s,
			color 0.15s;
	}

	.tab.active {
		background: var(--color-surface-2);
		color: var(--color-text);
	}

	@media (max-width: 767px) {
		.session-panels {
			display: block;
		}
	}
</style>
