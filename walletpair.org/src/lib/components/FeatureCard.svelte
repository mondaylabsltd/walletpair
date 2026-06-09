<script lang="ts">
	import type { Component } from 'svelte';

	let {
		title,
		description,
		icon: Icon
	}: { title: string; description: string; icon: Component } = $props();
</script>

<div class="card">
	<div class="card-icon">
		<Icon size={24} strokeWidth={1.5} />
	</div>
	<h3 class="card-title">{title}</h3>
	<p class="card-desc">{description}</p>
</div>

<style>
	.card {
		padding: var(--space-6);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		transition: border-color 0.15s;
	}

	.card:hover {
		border-color: var(--color-text-subtle);
	}

	.card-icon {
		margin-bottom: var(--space-3);
		color: var(--color-accent);
	}

	.card-title {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: var(--space-2);
		font-family: var(--font-mono);
		letter-spacing: -0.01em;
	}

	.card-desc {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		line-height: 1.5;
	}
</style>
