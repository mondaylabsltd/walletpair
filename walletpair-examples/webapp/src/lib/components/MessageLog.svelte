<script lang="ts">
	type LogEntry = { dir: 'out' | 'in' | 'err'; type: string; detail: string };

	let { entries }: { entries: LogEntry[] } = $props();

	let logEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (entries.length && logEl) {
			logEl.scrollTop = logEl.scrollHeight;
		}
	});
</script>

<section>
	<h3>Message Log</h3>
	<div class="log-wrap" bind:this={logEl}>
		{#each entries as entry}
			<div class="log-entry">
				<span class="dir {entry.dir}">
					{entry.dir === 'out' ? '\u2192' : entry.dir === 'in' ? '\u2190' : '\u2715'}
				</span>
				<span class="type">{entry.type}</span>
				<span class="body">{entry.detail}</span>
			</div>
		{/each}
	</div>
</section>
