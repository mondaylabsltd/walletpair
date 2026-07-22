<script lang="ts">
	import '$lib/styles/prose.css';
	import DocsSidebar from '$lib/components/DocsSidebar.svelte';

	let { children } = $props();
</script>

<div class="docs-layout">
	<DocsSidebar />
	<article class="docs-content prose">
		{@render children()}
	</article>
</div>

<style>
	.docs-layout {
		max-width: var(--max-w-wide);
		margin: 0 auto;
		display: flex;
		padding: var(--space-8) var(--space-6);
		gap: var(--space-8);
	}

	.docs-content {
		flex: 1;
		min-width: 0;
		max-width: var(--max-w-content);
	}

	@media (max-width: 768px) {
		.docs-layout {
			flex-direction: column;
			padding: var(--space-4) var(--space-4);
		}

		.docs-layout :global(.sidebar) {
			position: static;
			width: 100%;
			padding-right: 0;
			padding-bottom: var(--space-4);
			border-bottom: 1px solid var(--color-border);
			margin-bottom: var(--space-4);
			max-height: none;
		}

		.docs-layout :global(.sidebar nav) {
			flex-direction: row;
			flex-wrap: wrap;
			gap: var(--space-1);
		}
	}
</style>
