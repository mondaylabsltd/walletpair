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
		content="Minimal, self-sovereign protocol for connecting dApps to wallets. No registration, end-to-end encrypted, transport agnostic."
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
