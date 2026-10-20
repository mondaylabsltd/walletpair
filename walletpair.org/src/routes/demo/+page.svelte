<script lang="ts">
	import DemoDapp from '$lib/demo/DemoDapp.svelte';
	import DemoWallet from '$lib/demo/DemoWallet.svelte';
</script>

<svelte:head>
	<title>Demo — WalletPair</title>
</svelte:head>

<section class="demo">
	<h1>Try WalletPair</h1>
	<ol class="steps">
		<li>Install the <a href="/docs/install-extension">WalletPair extension</a>.</li>
		<li>Click <strong>Connect</strong> in the demo dApp. The extension's panel shows a pairing QR code: click <em>Copy link</em>.</li>
		<li>Paste the link into the demo wallet and click <strong>Pair</strong>, then approve its requests there.</li>
	</ol>
	<p class="note">
		The demo wallet stands in for the wallet on your phone. Its test keys are made in this browser and never leave it;
		transactions are signed, never sent. To try the demo wallet with other dApps, open it on its own:
		<a href="/demo/wallet">/demo/wallet</a>.
	</p>
	<div class="panes">
		<DemoDapp />
		<DemoWallet />
	</div>
</section>

<style>
	.demo {
		max-width: var(--max-w-wide);
		margin: 0 auto;
		padding: var(--space-12) var(--space-6);
	}

	h1 {
		font-size: 1.75rem;
		margin-bottom: var(--space-4);
	}

	.steps {
		color: var(--color-text-muted);
		line-height: 1.7;
		margin-bottom: var(--space-3);
		padding-left: var(--space-6);
	}

	.note {
		color: var(--color-text-subtle);
		font-size: 0.85rem;
		margin-bottom: var(--space-8);
	}

	.panes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-6);
		align-items: start;
	}

	@media (max-width: 900px) {
		.panes {
			grid-template-columns: 1fr;
		}
	}
</style>
