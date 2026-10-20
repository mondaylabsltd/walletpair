<script lang="ts">
	let { data } = $props();
</script>

<svelte:head><title>Protocol: {data.title} — WalletPair</title></svelte:head>

<!-- Trusted content: the repository's spec/, rendered at build time. -->
<!-- eslint-disable-next-line svelte/no-at-html-tags -->
{@html data.html}
