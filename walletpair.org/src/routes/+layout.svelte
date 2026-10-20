<script lang="ts">
	import '$lib/styles/global.css';
	import SiteHeader from '$lib/components/SiteHeader.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<title>WalletPair — Connect dApps to Wallets</title>
	<meta
		name="description"
		content="Connect dApps to wallets with a few functions over an end-to-end encrypted link. No registration, no servers to run."
	/>
</svelte:head>

<SiteHeader />
<main>
	{@render children()}
</main>
<SiteFooter />

<style>
	main {
		min-height: calc(100vh - 56px);
	}
</style>
