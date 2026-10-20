<script lang="ts">
	let { data } = $props();
</script>

<svelte:head><title>Protocol — WalletPair</title></svelte:head>

<!-- Trusted content: SPEC.md from this repository, rendered at build time. -->
<!-- eslint-disable-next-line svelte/no-at-html-tags -->
{@html data.html}
