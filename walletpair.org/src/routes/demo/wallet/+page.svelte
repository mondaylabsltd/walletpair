<script lang="ts">
	import DemoWallet from '$lib/demo/DemoWallet.svelte';
</script>

<svelte:head>
	<title>Demo wallet — WalletPair</title>
</svelte:head>

<section class="demo">
	<h1>Demo wallet</h1>
	<p class="intro">
		A WalletPair wallet for EVM chains that runs in this page, standing in for the wallet on your phone.
		Connect any dApp in another tab with the <a href="/docs/install-extension">WalletPair extension</a>, copy the
		pairing link from the extension's panel, and paste it here. Test keys only: they are made in this browser, and
		transactions are signed, never sent.
	</p>
	<DemoWallet />
</section>

<style>
	.demo {
		max-width: 640px;
		margin: 0 auto;
		padding: var(--space-12) var(--space-6);
	}

	h1 {
		font-size: 1.75rem;
		margin-bottom: var(--space-4);
	}

	.intro {
		color: var(--color-text-muted);
		line-height: 1.6;
		margin-bottom: var(--space-6);
	}
</style>
