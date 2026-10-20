<script lang="ts">
	import { onMount } from 'svelte';
	import { discover, messageHex, typedData, verifyEvmMessage, verifyEvmTyped, type Eip1193 } from './dapp';

	const MESSAGE = 'Hello from the WalletPair demo';

	let evm = $state<Eip1193 | undefined>(undefined);
	let searched = $state(false);

	let evmAccount = $state<string | undefined>(undefined);
	let evmChain = $state<string | undefined>(undefined);

	interface Result {
		id: number;
		network: string;
		action: string;
		verified?: boolean;
		detail: string;
	}
	let results = $state<Result[]>([]);
	let next = 1;
	let busy = $state('');

	onMount(async () => {
		evm = await discover();
		searched = true;
		evm?.on('chainChanged', (chainId: string) => (evmChain = chainId));
		evm?.on('accountsChanged', (accounts: string[]) => (evmAccount = accounts[0]));
	});

	/** Runs an action and records what came back. */
	async function run(network: string, action: string, task: () => Promise<{ detail: string; verified?: boolean }>) {
		busy = `${network} ${action}`;
		try {
			const { detail, verified } = await task();
			results = [{ id: next++, network, action, detail, verified }, ...results];
		} catch (error) {
			const e = error as { code?: number; message?: string } | string;
			const text = typeof e === 'string' ? e : `${e.code !== undefined ? `${e.code} ` : ''}${e.message ?? 'failed'}`;
			results = [{ id: next++, network, action, detail: text, verified: false }, ...results];
		} finally {
			busy = '';
		}
	}

	const evmConnect = () =>
		run('EVM', 'Connect', async () => {
			const accounts: string[] = await evm!.request({ method: 'eth_requestAccounts' });
			evmAccount = accounts[0];
			evmChain = await evm!.request({ method: 'eth_chainId' });
			return { detail: `${evmAccount} on chain ${BigInt(evmChain!)}` };
		});

	const evmSign = () =>
		run('EVM', 'Sign message', async () => {
			const signature = await evm!.request({ method: 'personal_sign', params: [messageHex(MESSAGE), evmAccount] });
			return { detail: signature, verified: await verifyEvmMessage(evmAccount!, MESSAGE, signature) };
		});

	const evmTyped = () =>
		run('EVM', 'Sign typed data', async () => {
			const typed = typedData(Number(BigInt(evmChain ?? '0x1')));
			const signature = await evm!.request({ method: 'eth_signTypedData_v4', params: [evmAccount, JSON.stringify(typed)] });
			return { detail: signature, verified: await verifyEvmTyped(evmAccount!, typed, signature) };
		});

	const evmSend = () =>
		run('EVM', 'Send transaction', async () => {
			const hash = await evm!.request({ method: 'eth_sendTransaction', params: [{ from: evmAccount, to: evmAccount, value: '0x0' }] });
			return { detail: `${hash} (the demo wallet signs, it does not broadcast)` };
		});

	const evmSwitch = () =>
		run('EVM', 'Switch network', async () => {
			const target = evmChain === '0x89' ? '0x1' : '0x89';
			await evm!.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target }] });
			evmChain = await evm!.request({ method: 'eth_chainId' });
			return { detail: `now on chain ${BigInt(evmChain!)}` };
		});
</script>

<div class="dapp">
	<header class="dapp-head">
		<h2>Demo dApp</h2>
		<span class="hint">uses the WalletPair extension</span>
	</header>

	{#if searched && !evm}
		<p class="notice">
			The WalletPair extension was not found in this browser. <a href="/docs/install-extension">Install it</a>, then
			reload this page.
		</p>
	{/if}

	<section class="network">
		<h3>EVM</h3>
		<p class="who">{evmAccount ? `${evmAccount} · chain ${BigInt(evmChain ?? '0x1')}` : 'not connected'}</p>
		<div class="row">
			<button class="primary" disabled={!evm || !!busy} onclick={evmConnect}>Connect</button>
			<button disabled={!evmAccount || !!busy} onclick={evmSign}>Sign message</button>
			<button disabled={!evmAccount || !!busy} onclick={evmTyped}>Sign typed data</button>
			<button disabled={!evmAccount || !!busy} onclick={evmSend}>Send transaction</button>
			<button disabled={!evmAccount || !!busy} onclick={evmSwitch}>Switch network</button>
		</div>
	</section>

	{#if busy}<p class="busy">Waiting for the wallet: {busy}…</p>{/if}

	{#if results.length}
		<ol class="results">
			{#each results as result (result.id)}
				<li class:ok={result.verified === true} class:bad={result.verified === false}>
					<span class="label">{result.network} · {result.action}</span>
					{#if result.verified === true}<span class="mark">✓ signature verified</span>{/if}
					<code>{result.detail}</code>
				</li>
			{/each}
		</ol>
	{/if}
</div>

<style>
	.dapp {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}

	.dapp-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
	}

	h2 {
		font-size: 1.1rem;
		font-family: var(--font-mono);
	}

	h3 {
		font-size: 0.9rem;
		margin-bottom: var(--space-1);
	}

	.hint,
	.who,
	.busy {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.who {
		font-family: var(--font-mono);
		margin-bottom: var(--space-2);
		word-break: break-all;
	}

	.notice {
		color: var(--color-warning);
		font-size: 0.9rem;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	button {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		padding: var(--space-2) var(--space-3);
		font-size: 0.8rem;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	button.primary {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: #fff;
	}

	.results {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-height: 320px;
		overflow-y: auto;
	}

	.results li {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		font-size: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.results li.ok {
		border-color: var(--color-success);
	}

	.results li.bad {
		border-color: var(--color-error);
	}

	.label {
		font-weight: 600;
	}

	.mark {
		color: var(--color-success);
	}

	code {
		font-family: var(--font-mono);
		color: var(--color-text-muted);
		word-break: break-all;
	}
</style>
