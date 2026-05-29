<script lang="ts">
	let { title, description, icon }: { title: string; description: string; icon: string } = $props();
</script>

<div class="card">
	<div class="card-icon">{icon}</div>
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
		font-size: 1.5rem;
		margin-bottom: var(--space-3);
		font-family: var(--font-mono);
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
