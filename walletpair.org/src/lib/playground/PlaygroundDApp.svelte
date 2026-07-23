<script lang="ts">
	import QRCode from 'qrcode';
	import {
		DAppSession,
		createRequest,
		isEvmEvent,
		isEvmResponse,
		type JsonValue,
		type ParticipantMeta,
		type SessionPhase
	} from '$lib/walletpair/protocol';
	import { createLocalRelaySocket } from './local-relay';
	import MessageLog from './MessageLog.svelte';
	import { playground, type LogEntry } from './state.svelte';

	type RequestResult = {
		id: string;
		method: string;
		state: 'pending' | 'approved' | 'rejected';
		result?: JsonValue;
		error?: { code: number; message: string };
	};

	let session: DAppSession | null = $state(null);
	let phase: SessionPhase = $state('idle');
	let pairingUri = $state('');
	let pairingCode = $state('----');
	let qrDataUrl = $state('');
	let peerMeta = $state<ParticipantMeta | null>(null);
	let metaName = $state('WalletPair Playground');
	let metaUrl = $state('https://walletpair.org');
	let metaIcon = $state('https://walletpair.org/icon.png');
	let showAdvanced = $state(false);
	let method = $state('eth_requestAccounts');
	let paramsText = $state('[]');
	let requestResults = $state<RequestResult[]>([]);
	let log = $state<LogEntry[]>([]);
	let copied = $state(false);

	function addLog(dir: LogEntry['dir'], type: string, detail = '') {
		const now = new Date();
		const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
		log = [...log, { dir, type, detail, time }];
	}

	function dappMeta(): ParticipantMeta {
		return {
			name: metaName || 'WalletPair Playground',
			url: metaUrl || 'https://walletpair.org',
			icon: metaIcon || 'https://walletpair.org/icon.png'
		};
	}

	function phaseLabel(): string {
		if (phase === 'idle') return 'Ready';
		if (phase === 'pairing') return 'Waiting for wallet';
		if (phase === 'connected') return 'Paired';
		return phase.replace('_', ' ');
	}

	async function renderQr(uri: string) {
		try {
			qrDataUrl = await QRCode.toDataURL(uri, {
				width: 200,
				margin: 2,
				color: { dark: '#e6edf3', light: '#141416' }
			});
		} catch {
			qrDataUrl = '';
		}
	}

	async function startPairing() {
		if (phase !== 'idle') return;
		try {
			const next = new DAppSession({
				relayUrl: playground.relayUrl,
				meta: dappMeta(),
				webSocketFactory: playground.transport === 'local' ? createLocalRelaySocket : undefined,
				onPhase: (nextPhase) => {
					phase = nextPhase;
					addLog('in', 'phase', nextPhase);
				},
				onPeer: (peer) => {
					peerMeta = peer;
					addLog('in', 'channel_joined', peer.name);
				},
				onMessage: (message, chainId) => {
					if (isEvmResponse(message)) {
						requestResults = requestResults.map((request) =>
							request.id === message.id
								? 'error' in message
									? { ...request, state: 'rejected', error: message.error }
									: { ...request, state: 'approved', result: message.result }
								: request
						);
						addLog('in', 'response', `${message.id} @ ${chainId}`);
					} else if (isEvmEvent(message)) {
						addLog('in', 'event', `${message.event} @ ${chainId}`);
					} else {
						addLog('err', 'message', 'Received an invalid EVM response/event envelope');
					}
				},
				onError: (error) => addLog('err', 'protocol', error.message)
			});
			session = next;
			pairingUri = next.pairingUri;
			pairingCode = next.pairingCode;
			playground.pairingUri = pairingUri;
			await renderQr(pairingUri);
			await next.start();
			addLog('out', 'connect', 'Relay connection established');
		} catch (error) {
			addLog('err', 'connect', error instanceof Error ? error.message : 'Unable to start pairing');
		}
	}

	function sendRequest() {
		if (!session || phase !== 'connected') return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(paramsText);
		} catch {
			addLog('err', 'params', 'Parameters must be valid JSON');
			return;
		}
		if (!Array.isArray(parsed) && (typeof parsed !== 'object' || parsed === null)) {
			addLog('err', 'params', 'EIP-1193 params must be an array or object');
			return;
		}
		try {
			const request = createRequest(method, parsed as JsonValue[] | { [key: string]: JsonValue });
			session.send(request);
			const pendingRequest: RequestResult = {
				id: request.id,
				method: request.method,
				state: 'pending'
			};
			requestResults = [pendingRequest, ...requestResults].slice(0, 6);
			addLog('out', 'request', `${method} @ eip155:1`);
		} catch (error) {
			addLog('err', 'request', error instanceof Error ? error.message : 'Unable to send request');
		}
	}

	function reset() {
		session?.close();
		session = null;
		phase = 'idle';
		pairingUri = '';
		pairingCode = '----';
		qrDataUrl = '';
		peerMeta = null;
		requestResults = [];
		playground.pairingUri = '';
		log = [];
	}

	function onMethodChange() {
		if (method === 'personal_sign')
			paramsText = '["0x48656c6c6f2057616c6c65745061697221", "0x..."]';
		else if (method === 'eth_sendTransaction')
			paramsText = '[{"from":"0x...","to":"0x...","value":"0x0","data":"0x"}]';
		else if (method === 'wallet_switchEthereumChain') paramsText = '[{"chainId":"0x1"}]';
		else paramsText = '[]';
	}

	async function copyUri() {
		await navigator.clipboard.writeText(pairingUri);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<div class="panel">
	<div class="panel-header">
		<div>
			<div class="step">Step 1</div>
			<h3>Create a pairing QR <span class="badge">EVM</span></h3>
		</div>
		<span class:connected={phase === 'connected'} class="status">{phaseLabel()}</span>
	</div>

	{#if phase === 'idle'}
		<p class="intro">Create a one-time pairing, then continue in the Wallet panel.</p>
		<button class="btn-primary btn-large" onclick={startPairing}>Create pairing QR</button>

		<div class="advanced">
			<button class="meta-toggle" onclick={() => (showAdvanced = !showAdvanced)}
				>{showAdvanced ? '▾' : '▸'} Advanced connection settings</button
			>
			{#if showAdvanced}
				<div class="field">
					<label class="label" for="dapp-transport">Delivery mode</label>
					<select id="dapp-transport" bind:value={playground.transport}>
						<option value="local">Same-page demo (local relay)</option>
						<option value="relay">Configured WebSocket relay</option>
					</select>
					{#if playground.transport === 'local'}
						<p class="setting-hint">
							Both roles stay in this tab; encrypted frames use a local relay simulation.
						</p>
					{/if}
				</div>
				{#if playground.transport === 'relay'}
					<div class="field">
						<label class="label" for="dapp-relay">Relay URL</label>
						<input
							id="dapp-relay"
							bind:value={playground.relayUrl}
							placeholder="wss://relay.example/v1"
						/>
					</div>
				{/if}
				<div class="field">
					<div class="label">dApp identity</div>
					<input bind:value={metaName} placeholder="dApp name" />
					<input bind:value={metaUrl} placeholder="https://dapp.example" />
					<input bind:value={metaIcon} placeholder="https://dapp.example/icon.png" />
				</div>
			{/if}
		</div>
	{:else}
		<div class="pairing-state">
			<div>
				<div class="label">Scan or share this pairing</div>
				<p>Open the Wallet panel, use the current pairing, and compare the code below.</p>
			</div>
			{#if qrDataUrl}<div class="qr-wrap">
					<img src={qrDataUrl} alt="WalletPair pairing QR code" />
				</div>{/if}
			<div class="pairing-code-wrap">
				<div class="label">Pairing code</div>
				<div class="pairing-code">{pairingCode}</div>
			</div>
			<div class="uri-box">{pairingUri}</div>
			<button class="btn-small" onclick={copyUri}>{copied ? 'Copied' : 'Copy pairing link'}</button>
		</div>
		<button class="btn-danger close" onclick={reset}>Close pairing</button>
	{/if}

	{#if phase === 'connected'}
		<div class="connected-banner" aria-live="polite">
			<span>✓</span> Paired successfully — send a test request below.
		</div>
		{#if peerMeta}<div class="peer">
				Connected to <strong>{peerMeta.name}</strong> · {peerMeta.url}
			</div>{/if}
		<div class="request-field">
			<div>
				<div class="step">Step 3</div>
				<div class="label">Send a test request on <code>eip155:1</code></div>
			</div>
			<select bind:value={method} onchange={onMethodChange}>
				<option value="eth_requestAccounts">eth_requestAccounts</option>
				<option value="eth_accounts">eth_accounts</option>
				<option value="eth_chainId">eth_chainId</option>
				<option value="net_version">net_version</option>
				<option value="personal_sign">personal_sign</option>
				<option value="eth_sendTransaction">eth_sendTransaction</option>
				<option value="wallet_switchEthereumChain">wallet_switchEthereumChain</option>
			</select>
			<textarea bind:value={paramsText} rows="3" placeholder="JSON params"></textarea>
			<button class="btn-primary" onclick={sendRequest}>Send request</button>
		</div>

		{#if requestResults.length > 0}
			<div class="request-results" aria-live="polite">
				<div class="label">Request results</div>
				{#each requestResults as request (request.id)}
					<div class="request-result">
						<div class="request-result-header">
							<strong>{request.method}</strong>
							<span
								class:pending={request.state === 'pending'}
								class:approved={request.state === 'approved'}
								class:rejected={request.state === 'rejected'}
								class="request-state"
							>
								{request.state === 'pending'
									? 'Waiting for wallet'
									: request.state === 'approved'
										? 'Wallet response'
										: 'Wallet error'}
							</span>
						</div>
						{#if request.state === 'pending'}
							<p>The wallet has not approved or rejected this request yet.</p>
						{:else if request.state === 'approved'}
							<code>{JSON.stringify(request.result ?? null)}</code>
						{:else}
							<p>{request.error?.message ?? 'The wallet rejected this request.'}</p>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/if}

	{#if log.length > 0}
		<details class="activity">
			<summary>Protocol activity <span>{log.length}</span></summary>
			<MessageLog entries={log} />
		</details>
	{/if}
</div>

<style>
	.panel {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.panel-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.panel-header {
		justify-content: space-between;
		align-items: flex-start;
	}
	.step {
		color: var(--color-accent);
		font: 600 0.68rem var(--font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		margin-bottom: 3px;
	}
	h3 {
		font-family: var(--font-mono);
		font-size: 1rem;
	}
	.badge {
		color: #a78bfa;
		border: 1px solid #a78bfa55;
		border-radius: var(--radius-sm);
		font-size: 0.65rem;
		padding: 1px 6px;
	}
	.status {
		color: var(--color-text-muted);
		font: 0.8rem var(--font-mono);
	}
	.status.connected {
		color: var(--color-success);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.intro,
	.pairing-state p,
	.setting-hint {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 0.86rem;
		line-height: 1.55;
	}
	.setting-hint {
		font-size: 0.78rem;
	}
	.label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	input,
	select,
	textarea {
		width: 100%;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		padding: var(--space-2);
		font: 0.8rem var(--font-mono);
	}
	textarea {
		resize: vertical;
	}
	button {
		cursor: pointer;
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		font-size: 0.8rem;
		white-space: nowrap;
	}
	button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}
	.btn-primary {
		background: var(--color-accent);
		color: white;
		border-color: var(--color-accent);
	}
	.btn-large {
		width: 100%;
		padding: var(--space-3) var(--space-4);
		font-size: 0.9rem;
		font-weight: 600;
	}
	.btn-danger {
		background: transparent;
		color: var(--color-error);
		border-color: var(--color-error);
	}
	.btn-small,
	.meta-toggle {
		align-self: flex-start;
		background: transparent;
		color: var(--color-text-muted);
	}
	.advanced {
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.pairing-state {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.qr-wrap {
		align-self: center;
		padding: var(--space-2);
		background: #141416;
		border-radius: var(--radius-md);
	}
	.qr-wrap img {
		display: block;
		width: 180px;
		height: 180px;
	}
	.uri-box {
		overflow-wrap: anywhere;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		font: 0.7rem var(--font-mono);
		color: var(--color-text-muted);
	}
	.pairing-code {
		font: 600 1.6rem var(--font-mono);
		letter-spacing: 0.18em;
		color: var(--color-accent);
	}
	.pairing-code-wrap {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.close {
		align-self: flex-start;
	}
	.peer {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		padding: var(--space-2);
		border-left: 2px solid var(--color-accent);
	}
	.connected-banner {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		padding: var(--space-3);
		border: 1px solid color-mix(in srgb, var(--color-success) 45%, transparent);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-success) 10%, transparent);
		color: var(--color-text);
		font-size: 0.84rem;
	}
	.connected-banner span {
		color: var(--color-success);
		font-weight: 700;
	}
	.request-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border);
	}
	.request-results {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.request-result {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.request-result-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		font: 0.8rem var(--font-mono);
	}
	.request-result p {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 0.8rem;
	}
	.request-result code {
		overflow-wrap: anywhere;
		color: var(--color-text);
		font-size: 0.78rem;
	}
	.request-state {
		padding: 2px 6px;
		border-radius: 999px;
		background: var(--color-surface-2);
		color: var(--color-text-muted);
		font-size: 0.67rem;
		white-space: nowrap;
	}
	.request-state.pending {
		color: #fbbf24;
	}
	.request-state.approved {
		color: var(--color-success);
	}
	.request-state.rejected {
		color: var(--color-error);
	}
	.activity {
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-3);
	}
	.activity summary {
		cursor: pointer;
		color: var(--color-text-muted);
		font: 0.75rem var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.activity summary span {
		font-size: 0.65rem;
		background: var(--color-surface-2);
		padding: 0 5px;
		border-radius: 8px;
	}
	.activity :global(.log-section) {
		margin-top: var(--space-3);
	}
</style>
