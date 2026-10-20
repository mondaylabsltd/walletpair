<script lang="ts">
	import { onMount } from 'svelte';
	import { CHAINS, DemoWallet } from './wallet.svelte';

	const NAMES: Record<string, string> = { eip155: 'EVM' };

	const wallet = new DemoWallet();
	let link = $state('');

	onMount(() => {
		void wallet.start();
	});

	function pair(event: SubmitEvent) {
		event.preventDefault();
		wallet.pair(link);
		if (!wallet.error) link = '';
	}

	const short = (address: string) => `${address.slice(0, 8)}…${address.slice(-6)}`;
	const statusText = $derived(
		!wallet.paired
			? 'Not paired'
			: wallet.connection === 'connected'
				? 'Connected to the extension'
				: wallet.connection === 'waiting'
					? 'Waiting for the extension'
					: 'Offline'
	);
</script>

<div class="wallet">
	<header class="wallet-head">
		<h2>Demo wallet</h2>
		<span class="badge">Test keys only</span>
	</header>

	{#if wallet.elsewhere}
		<p class="notice">The demo wallet is open in another tab. Close it there to use it here.</p>
	{:else}
		<p class="status" class:online={wallet.connection === 'connected'}>
			<span class="dot"></span>
			{statusText}{wallet.dapp ? ` · ${wallet.dapp}` : ''}
		</p>

		{#if !wallet.paired}
			<form class="pair" onsubmit={pair}>
				<label for="pairing-link">Pairing link from the WalletPair extension (<em>Copy link</em>)</label>
				<div class="pair-row">
					<input id="pairing-link" bind:value={link} placeholder="walletpair:wss://…#…" autocomplete="off" />
					<button type="submit" class="primary" disabled={!link.trim()}>Pair</button>
				</div>
				{#if wallet.error}<p class="error">{wallet.error}</p>{/if}
			</form>
		{/if}

		{#each wallet.prompts as prompt (prompt.id)}
			<div class="prompt">
				<div class="prompt-title">
					<strong>{prompt.description.title}</strong>
					{#if prompt.description.origin}<span class="origin">{prompt.description.origin}</span>{/if}
				</div>
				<dl>
					{#each prompt.description.fields as [label, value] (label)}
						<dt>{label}</dt>
						<dd>{value}</dd>
					{/each}
				</dl>
				<div class="buttons">
					<button class="reject" onclick={() => prompt.answer(false)}>Reject</button>
					<button class="primary approve" onclick={() => prompt.answer(true)}>Approve</button>
				</div>
			</div>
		{/each}

		<div class="accounts">
			{#each wallet.accounts as account (account.namespace)}
				<div class="account">
					<span class="network">{NAMES[account.namespace]}</span>
					<code title={account.address}>{short(account.address)}</code>
					<select
						aria-label={`${NAMES[account.namespace]} network`}
						value={account.chain}
						onchange={(e) => wallet.setChain(account.namespace, e.currentTarget.value)}
					>
						{#each CHAINS[account.namespace] as [chain, name] (chain)}
							<option value={chain}>{name}</option>
						{/each}
					</select>
					{#if wallet.approved.includes(account.namespace)}<span class="approved">approved</span>{/if}
				</div>
			{/each}
		</div>

		<div class="actions">
			{#if wallet.paired}
				<button onclick={() => wallet.revoke()} disabled={!wallet.approved.length}>Revoke approval</button>
				<button class="danger" onclick={() => wallet.end()}>End session</button>
			{:else}
				<button onclick={() => wallet.newKeys()}>New test keys</button>
			{/if}
		</div>

		{#if wallet.log.length}
			<ol class="log">
				{#each wallet.log as entry, i (i)}
					<li><span>{entry.time}</span> {entry.text}</li>
				{/each}
			</ol>
		{/if}
	{/if}
</div>

<style>
	.wallet {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}

	.wallet-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	h2 {
		font-size: 1.1rem;
		font-family: var(--font-mono);
	}

	.badge {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-warning);
		border: 1px solid var(--color-warning);
		border-radius: 100px;
		padding: 2px 8px;
	}

	.status {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-text-subtle);
	}

	.status.online .dot {
		background: var(--color-success);
	}

	.pair label {
		display: block;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin-bottom: var(--space-2);
	}

	.pair-row {
		display: flex;
		gap: var(--space-2);
	}

	input,
	select {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		padding: var(--space-2) var(--space-3);
		font-family: var(--font-mono);
		font-size: 0.8rem;
		min-width: 0;
	}

	input {
		flex: 1;
	}

	button {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		padding: var(--space-2) var(--space-4);
		font-size: 0.85rem;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	button.primary {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: #fff;
	}

	button.danger:hover {
		border-color: var(--color-error);
		color: var(--color-error);
	}

	.error {
		color: var(--color-error);
		font-size: 0.8rem;
		margin-top: var(--space-2);
	}

	.notice {
		color: var(--color-warning);
		font-size: 0.9rem;
	}

	.prompt {
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-md);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		background: rgba(59, 130, 246, 0.06);
	}

	.prompt-title {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.origin {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--space-1) var(--space-3);
		font-size: 0.8rem;
		margin: 0;
	}

	dt {
		color: var(--color-text-muted);
	}

	dd {
		margin: 0;
		font-family: var(--font-mono);
		white-space: pre-wrap;
		word-break: break-all;
	}

	.buttons,
	.actions {
		display: flex;
		gap: var(--space-2);
		justify-content: flex-end;
		flex-wrap: wrap;
	}

	.accounts {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.account {
		display: grid;
		grid-template-columns: 56px 1fr auto auto;
		align-items: center;
		gap: var(--space-2);
		font-size: 0.8rem;
	}

	.network {
		font-weight: 600;
	}

	code {
		font-family: var(--font-mono);
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.approved {
		font-size: 0.7rem;
		color: var(--color-success);
	}

	.log {
		list-style: none;
		padding: 0;
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		max-height: 160px;
		overflow-y: auto;
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-3);
	}

	.log span {
		color: var(--color-text-subtle);
		font-family: var(--font-mono);
		margin-right: var(--space-2);
	}

	@media (max-width: 520px) {
		.account {
			grid-template-columns: 56px 1fr;
		}
	}
</style>
