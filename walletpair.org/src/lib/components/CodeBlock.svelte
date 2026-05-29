<script lang="ts">
	let {
		code,
		lang = 'typescript',
		filename = ''
	}: { code: string; lang?: string; filename?: string } = $props();

	let copied = $state(false);

	function copy() {
		navigator.clipboard.writeText(code);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<div class="codeblock">
	<div class="codeblock-header">
		{#if filename}
			<span class="codeblock-filename">{filename}</span>
		{:else}
			<span class="codeblock-lang">{lang}</span>
		{/if}
		<button class="copy-btn" onclick={copy}>
			{copied ? 'Copied' : 'Copy'}
		</button>
	</div>
	<pre class="codeblock-pre"><code>{code}</code></pre>
</div>

<style>
	.codeblock {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		margin-bottom: var(--space-4);
	}

	.codeblock-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-4);
		background: var(--color-surface-2);
		border-bottom: 1px solid var(--color-border);
	}

	.codeblock-filename,
	.codeblock-lang {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--color-text-subtle);
	}

	.copy-btn {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--color-text-subtle);
		background: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 2px 8px;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.copy-btn:hover {
		color: var(--color-text-muted);
		border-color: var(--color-text-subtle);
	}

	.codeblock-pre {
		margin: 0;
		padding: var(--space-4);
		background: var(--color-surface);
		overflow-x: auto;
		font-size: 0.85rem;
		line-height: 1.6;
	}

	.codeblock-pre code {
		font-family: var(--font-mono);
		color: var(--color-text-muted);
		white-space: pre;
	}
</style>
