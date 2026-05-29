<script lang="ts">
	import PlaygroundDApp from '$lib/playground/PlaygroundDApp.svelte';
	import PlaygroundWallet from '$lib/playground/PlaygroundWallet.svelte';
	import { playground } from '$lib/playground/state.svelte.ts';

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
			Test the full WalletPair flow in your browser. Connect the dApp panel to the wallet
			panel, send requests, and see encrypted messages in real time.
		</p>
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
		{#if playground.activeTab === 'dapp'}
			<PlaygroundDApp />
		{:else}
			<PlaygroundWallet />
		{/if}
	{:else}
		<!-- Desktop: split view -->
		<div class="split">
			<PlaygroundDApp />
			<PlaygroundWallet />
		</div>
	{/if}
</div>

<style>
	.playground-wrap {
		max-width: var(--max-w-playground);
		margin: 0 auto;
		padding: var(--space-8) var(--space-6);
	}

	.playground-header {
		margin-bottom: var(--space-6);
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

	.split {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-4);
		align-items: start;
	}

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
</style>
