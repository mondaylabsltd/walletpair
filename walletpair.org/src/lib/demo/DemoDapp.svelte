<script lang="ts">
	import { onMount } from 'svelte';
	import {
		base58Encode,
		discover,
		discoverSolana,
		messageHex,
		solanaSignature,
		solanaTransfer,
		tronTransfer,
		typedData,
		verifyEd25519,
		verifyEvmMessage,
		verifyEvmTyped,
		verifyTronMessage,
		verifyTronTransaction,
		type Eip1193,
		type StandardWallet,
		type TronProvider
	} from './dapp';

	const MESSAGE = 'Hello from the WalletPair demo';

	let evm = $state<Eip1193 | undefined>(undefined);
	let tron = $state<TronProvider | undefined>(undefined);
	let solana = $state<StandardWallet | undefined>(undefined);
	let searched = $state(false);

	let evmAccount = $state<string | undefined>(undefined);
	let evmChain = $state<string | undefined>(undefined);
	let tronAccount = $state<string | undefined>(undefined);
	let solanaAccount = $state<{ address: string; publicKey: Uint8Array } | undefined>(undefined);
	let cluster = $state('solana:mainnet');

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
		[evm, tron] = await Promise.all([discover<Eip1193>('eip6963'), discover<TronProvider>('TIP6963')]);
		solana = discoverSolana();
		searched = true;
		evm?.on('chainChanged', (chainId: string) => (evmChain = chainId));
		evm?.on('accountsChanged', (accounts: string[]) => (evmAccount = accounts[0]));
		tron?.on('accountsChanged', (accounts: string[]) => (tronAccount = accounts[0]));
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

	const tronConnect = () =>
		run('TRON', 'Connect', async () => {
			const accounts: string[] = await tron!.request({ method: 'eth_requestAccounts' });
			tronAccount = accounts[0];
			const chainId: string = await tron!.request({ method: 'eth_chainId' });
			return { detail: `${tronAccount} on ${chainId}` };
		});

	const tronSigner = () => {
		if (!tron?.tronWeb) throw new Error('Connect first');
		return tron.tronWeb;
	};

	const tronSign = () =>
		run('TRON', 'Sign message', async () => {
			const signature = await tronSigner().trx.signMessageV2(MESSAGE);
			return { detail: signature, verified: await verifyTronMessage(tronAccount!, MESSAGE, signature) };
		});

	const tronTransaction = () =>
		run('TRON', 'Sign transaction', async () => {
			const tx = await tronTransfer(tronAccount!);
			const signed = await tronSigner().trx.sign(tx);
			return { detail: `txID ${tx.txID}`, verified: await verifyTronTransaction(tronAccount!, tx.txID, signed.signature[0]) };
		});

	const tronSwitch = () =>
		run('TRON', 'Switch network', async () => {
			const current: string = await tron!.request({ method: 'eth_chainId' });
			const target = current === '0xcd8690dc' ? '0x2b6653dc' : '0xcd8690dc';
			await tron!.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target }] });
			return { detail: `now on ${target === '0xcd8690dc' ? 'Nile' : 'Mainnet'}` };
		});

	const feature = (name: string) => solana!.features[name];

	const solanaConnect = () =>
		run('Solana', 'Connect', async () => {
			const { accounts } = await feature('standard:connect').connect();
			solanaAccount = accounts[0];
			return { detail: solanaAccount!.address };
		});

	const solanaSign = () =>
		run('Solana', 'Sign message', async () => {
			const message = new TextEncoder().encode(MESSAGE);
			const [output] = await feature('solana:signMessage').signMessage({ account: solanaAccount, message });
			return { detail: base58Encode(output.signature), verified: verifyEd25519(solanaAccount!.address, message, output.signature) };
		});

	const solanaTransaction = () =>
		run('Solana', 'Sign transaction', async () => {
			const transaction = solanaTransfer(solanaAccount!.address);
			const [output] = await feature('solana:signTransaction').signTransaction({ account: solanaAccount, transaction });
			const { signature, message } = solanaSignature(output.signedTransaction);
			return { detail: base58Encode(signature), verified: verifyEd25519(solanaAccount!.address, message, signature) };
		});

	const solanaSend = () =>
		run('Solana', 'Sign and send', async () => {
			const transaction = solanaTransfer(solanaAccount!.address);
			const [output] = await feature('solana:signAndSendTransaction').signAndSendTransaction({ account: solanaAccount, transaction, chain: cluster });
			return { detail: `${base58Encode(output.signature)} (the demo wallet signs, it does not broadcast)` };
		});
</script>

<div class="dapp">
	<header class="dapp-head">
		<h2>Demo dApp</h2>
		<span class="hint">uses the WalletPair extension</span>
	</header>

	{#if searched && !evm && !tron && !solana}
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

	<section class="network">
		<h3>TRON</h3>
		<p class="who">{tronAccount ?? 'not connected'}</p>
		<div class="row">
			<button class="primary" disabled={!tron || !!busy} onclick={tronConnect}>Connect</button>
			<button disabled={!tronAccount || !!busy} onclick={tronSign}>Sign message</button>
			<button disabled={!tronAccount || !!busy} onclick={tronTransaction}>Sign transaction</button>
			<button disabled={!tronAccount || !!busy} onclick={tronSwitch}>Switch network</button>
		</div>
	</section>

	<section class="network">
		<h3>Solana</h3>
		<p class="who">{solanaAccount?.address ?? 'not connected'}</p>
		<div class="row">
			<button class="primary" disabled={!solana || !!busy} onclick={solanaConnect}>Connect</button>
			<button disabled={!solanaAccount || !!busy} onclick={solanaSign}>Sign message</button>
			<button disabled={!solanaAccount || !!busy} onclick={solanaTransaction}>Sign transaction</button>
			<button disabled={!solanaAccount || !!busy} onclick={solanaSend}>Sign and send</button>
			<select aria-label="Solana cluster" bind:value={cluster}>
				<option value="solana:mainnet">Mainnet</option>
				<option value="solana:devnet">Devnet</option>
				<option value="solana:testnet">Testnet</option>
			</select>
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

	button,
	select {
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
