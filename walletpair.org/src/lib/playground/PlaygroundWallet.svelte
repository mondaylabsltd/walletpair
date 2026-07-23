<script lang="ts">
	import { secp256k1 } from '@noble/curves/secp256k1';
	import { keccak_256 } from '@noble/hashes/sha3';
	import { concatBytes, utf8ToBytes } from '@noble/hashes/utils';
	import {
		WalletSession,
		isEvmRequest,
		type EvmRequest,
		type JsonValue,
		type ParticipantMeta,
		type SessionPhase
	} from '$lib/walletpair/protocol';
	import { createLocalRelaySocket } from './local-relay';
	import MessageLog from './MessageLog.svelte';
	import { playground, type LogEntry } from './state.svelte';

	function hexToBytes(value: string): Uint8Array {
		if (!/^[0-9a-f]{64}$/i.test(value))
			throw new TypeError('Expected a 32-byte hexadecimal private key');
		return Uint8Array.from(value.match(/.{2}/g)!, (byte) => Number.parseInt(byte, 16));
	}

	function bytesToHex(value: Uint8Array): string {
		return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
	}

	function addressFor(privateKey: string): string {
		const publicKey = secp256k1.getPublicKey(hexToBytes(privateKey), false);
		return `0x${bytesToHex(keccak_256(publicKey.slice(1)).slice(-20))}`;
	}

	function personalSign(privateKey: string, data: string): string {
		const payload = /^0x(?:[0-9a-fA-F]{2})*$/.test(data)
			? Uint8Array.from(data.slice(2).match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16))
			: utf8ToBytes(data);
		const prefix = utf8ToBytes(`\x19Ethereum Signed Message:\n${payload.length}`);
		const signature = secp256k1.sign(
			keccak_256(concatBytes(prefix, payload)),
			hexToBytes(privateKey)
		);
		return `0x${signature.r.toString(16).padStart(64, '0')}${signature.s.toString(16).padStart(64, '0')}${((signature.recovery ?? 0) + 27).toString(16).padStart(2, '0')}`;
	}

	let session: WalletSession | null = $state(null);
	let phase: SessionPhase = $state('idle');
	let pairingUriInput = $state('');
	let pairingCode = $state('----');
	let peerMeta = $state<ParticipantMeta | null>(null);
	let metaName = $state('WalletPair Playground Wallet');
	let metaUrl = $state('https://walletpair.org');
	let metaIcon = $state('https://walletpair.org/icon.png');
	let showAdvanced = $state(false);
	let privateKey = $state('');
	let address = $state('--');
	let pending = $state<EvmRequest[]>([]);
	let log = $state<LogEntry[]>([]);
	let eventName = $state('accountsChanged');
	let joinError = $state('');

	function addLog(dir: LogEntry['dir'], type: string, detail = '') {
		const now = new Date();
		const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
		log = [...log, { dir, type, detail, time }];
	}

	function walletMeta(): ParticipantMeta {
		return {
			name: metaName || 'WalletPair Playground Wallet',
			url: metaUrl || 'https://walletpair.org',
			icon: metaIcon || 'https://walletpair.org/icon.png'
		};
	}

	function phaseLabel(): string {
		if (phase === 'idle') return 'Ready';
		if (phase === 'awaiting_confirmation') return 'Verify code';
		if (phase === 'joining') return 'Joining';
		if (phase === 'connected') return 'Paired';
		return phase;
	}

	function useDappUri() {
		pairingUriInput = playground.pairingUri;
	}

	function generateKey() {
		let candidate: Uint8Array;
		do {
			candidate = crypto.getRandomValues(new Uint8Array(32));
		} while (!secp256k1.utils.isValidPrivateKey(candidate));
		privateKey = bytesToHex(candidate);
		updateKey();
	}

	function updateKey() {
		try {
			address = addressFor(privateKey.replace(/^0x/, '').trim());
		} catch {
			address = 'Invalid key';
		}
	}

	function preparePairing() {
		if (address === '--' || address === 'Invalid key') {
			addLog('err', 'key', 'Generate or enter a valid private key first');
			return;
		}
		try {
			const next = new WalletSession({
				meta: walletMeta(),
				webSocketFactory: playground.transport === 'local' ? createLocalRelaySocket : undefined,
				onPhase: (nextPhase) => {
					phase = nextPhase;
					addLog('in', 'phase', nextPhase);
				},
				onPeer: (peer) => {
					peerMeta = peer;
					addLog('in', 'dapp', peer.name);
				},
				onMessage: (message, chainId) => {
					if (isEvmRequest(message)) {
						pending = [...pending, message];
						addLog('in', 'request', `${message.method} @ ${chainId}`);
					} else {
						addLog('err', 'message', 'Received an invalid EVM request envelope');
					}
				},
				onError: (error) => addLog('err', 'protocol', error.message)
			});
			next.prepare(pairingUriInput);
			session = next;
			pairingCode = next.pairingCode;
			joinError = '';
			addLog('in', 'pairing_code', pairingCode);
		} catch (error) {
			addLog(
				'err',
				'prepare',
				error instanceof Error ? error.message : 'Unable to parse pairing URI'
			);
		}
	}

	async function confirmPairing() {
		if (!session) return;
		joinError = '';
		try {
			await session.confirm();
			addLog('out', 'connect', 'Encrypted channel confirmed');
		} catch (error) {
			joinError = error instanceof Error ? error.message : 'Unable to join the encrypted channel';
			addLog('err', 'connect', joinError);
		}
	}

	function sendResponse(id: string, result?: JsonValue, error?: { code: number; message: string }) {
		if (!session) return;
		try {
			session.send(error ? { id, error } : { id, result: result ?? null });
			addLog('out', 'response', id);
			pending = pending.filter((request) => request.id !== id);
		} catch (failure) {
			addLog(
				'err',
				'response',
				failure instanceof Error ? failure.message : 'Unable to send response'
			);
		}
	}

	function approve(request: EvmRequest) {
		const params = request.params;
		switch (request.method) {
			case 'eth_requestAccounts':
			case 'eth_accounts':
				sendResponse(request.id, [address]);
				break;
			case 'eth_chainId':
				sendResponse(request.id, '0x1');
				break;
			case 'net_version':
				sendResponse(request.id, '1');
				break;
			case 'personal_sign': {
				const message = Array.isArray(params) && typeof params[0] === 'string' ? params[0] : null;
				if (!message)
					sendResponse(request.id, undefined, {
						code: -32602,
						message: 'personal_sign requires [data, address]'
					});
				else sendResponse(request.id, personalSign(privateKey, message));
				break;
			}
			default:
				sendResponse(request.id, undefined, {
					code: 4200,
					message: 'Method is not supported by the playground wallet'
				});
		}
	}

	function reject(request: EvmRequest) {
		sendResponse(request.id, undefined, { code: 4001, message: 'User rejected the request' });
	}

	function pushEvent() {
		if (!session || phase !== 'connected') return;
		const data: JsonValue = eventName === 'accountsChanged' ? [address] : '0x1';
		try {
			session.send({ event: eventName, data });
			addLog('out', 'event', eventName);
		} catch (error) {
			addLog('err', 'event', error instanceof Error ? error.message : 'Unable to send event');
		}
	}

	function reset() {
		session?.close();
		session = null;
		phase = 'idle';
		pairingCode = '----';
		peerMeta = null;
		pending = [];
		log = [];
		joinError = '';
	}
</script>

<div class="panel">
	<div class="panel-header">
		<div>
			<div class="step">Step 2</div>
			<h3>Verify and join <span class="badge">EVM</span></h3>
		</div>
		<span class:connected={phase === 'connected'} class="status">{phaseLabel()}</span>
	</div>

	{#if phase === 'idle'}
		{#if address === '--' || address === 'Invalid key'}
			<div class="field">
				<p class="intro">
					Generate a temporary local wallet, then use the pairing created in Step 1.
				</p>
				<button class="btn-primary btn-large" onclick={generateKey}>Generate demo wallet</button>
			</div>
		{:else}
			<div class="account">
				<div>
					<div class="label">Demo account</div>
					<div class="address">{address}</div>
				</div>
				<button class="btn-small" onclick={generateKey}>Generate another</button>
			</div>
		{/if}

		<div class="field pairing-input">
			<div class="label">Pairing link</div>
			{#if playground.pairingUri}
				<button class="btn-current" onclick={useDappUri}>Use current pairing</button>
			{:else}
				<p class="hint">Create a pairing QR in the dApp panel first, or paste a pairing link.</p>
			{/if}
			<input bind:value={pairingUriInput} placeholder="Paste a walletpair: link" />
			<button
				class="btn-primary"
				onclick={preparePairing}
				disabled={!pairingUriInput || !privateKey}>Verify pairing code</button
			>
		</div>

		<div class="advanced">
			<button class="meta-toggle" onclick={() => (showAdvanced = !showAdvanced)}
				>{showAdvanced ? '▾' : '▸'} Advanced wallet settings</button
			>
			{#if showAdvanced}
				<div class="field">
					<label class="label" for="wallet-private-key">Demo private key</label>
					<div class="row">
						<input
							id="wallet-private-key"
							bind:value={privateKey}
							oninput={updateKey}
							type="password"
							placeholder="64 hex characters"
						/>
						<button class="btn-small" onclick={generateKey}>Generate</button>
					</div>
				</div>
				<div class="field">
					<div class="label">Wallet identity</div>
					<input bind:value={metaName} placeholder="Wallet name" />
					<input bind:value={metaUrl} placeholder="https://wallet.example" />
					<input bind:value={metaIcon} placeholder="https://wallet.example/icon.png" />
				</div>
			{/if}
		</div>
	{:else}
		{#if phase === 'awaiting_confirmation'}
			<div class="confirmation">
				<div class="label">Does this code match the dApp?</div>
				<div class="pairing-code">{pairingCode}</div>
				<p>Only join if both panels show the same four digits.</p>
				<button class="btn-primary btn-large" onclick={confirmPairing}>Code matches — join</button>
			</div>
		{:else if phase === 'joining'}
			<div class="confirmation" aria-live="polite">
				<div class="label">Joining encrypted channel</div>
				<p>Waiting for the relay to confirm this wallet connection…</p>
			</div>
		{:else if phase === 'error'}
			<div class="error-state" role="alert">
				<strong>Could not confirm the pairing.</strong>
				<span>{joinError || 'Close this pairing and try again with a fresh QR code.'}</span>
			</div>
		{/if}
		<button class="btn-danger close" onclick={reset}>Close pairing</button>
	{/if}

	{#if phase === 'connected'}
		<div class="connected-banner" aria-live="polite">
			<span>✓</span> Paired successfully — the dApp can send requests now.
		</div>
		{#if peerMeta}<div class="peer">
				Connected to <strong>{peerMeta.name}</strong> · {peerMeta.url}
			</div>{/if}
		<div class="field connected-section">
			<div class="label">Incoming EIP-1193 requests</div>
			{#if pending.length === 0}<div class="empty">No pending requests</div>{:else}
				{#each pending as request (request.id)}
					<div class="request">
						<strong>{request.method}</strong><code>{JSON.stringify(request.params ?? [])}</code>
						<div class="row">
							<button class="btn-primary" onclick={() => approve(request)}>Approve</button><button
								class="btn-danger"
								onclick={() => reject(request)}>Reject</button
							>
						</div>
					</div>
				{/each}
			{/if}
		</div>
		<div class="field">
			<div class="label">Wallet event on <code>eip155:1</code></div>
			<div class="row">
				<select bind:value={eventName}
					><option value="accountsChanged">accountsChanged</option><option value="chainChanged"
						>chainChanged</option
					></select
				><button class="btn-primary" onclick={pushEvent}>Send event</button>
			</div>
		</div>
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
	.panel-header,
	.row {
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
	.hint,
	.confirmation p {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 0.86rem;
		line-height: 1.55;
	}
	.label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	input,
	select {
		width: 100%;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		padding: var(--space-2);
		font: 0.8rem var(--font-mono);
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
	.btn-current {
		background: var(--color-surface-2);
		color: var(--color-text);
		text-align: left;
	}
	.advanced {
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.account,
	.confirmation {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.account {
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
	}
	.address,
	.empty {
		color: var(--color-text-muted);
		font: 0.75rem var(--font-mono);
		overflow-wrap: anywhere;
	}
	.pairing-code {
		font: 600 1.6rem var(--font-mono);
		letter-spacing: 0.18em;
		color: var(--color-accent);
	}
	.peer {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		padding: var(--space-2);
		border-left: 2px solid var(--color-accent);
	}
	.connected-banner,
	.error-state {
		display: flex;
		gap: var(--space-2);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		font-size: 0.84rem;
	}
	.connected-banner {
		align-items: center;
		border: 1px solid color-mix(in srgb, var(--color-success) 45%, transparent);
		background: color-mix(in srgb, var(--color-success) 10%, transparent);
		color: var(--color-text);
	}
	.connected-banner span {
		color: var(--color-success);
		font-weight: 700;
	}
	.error-state {
		flex-direction: column;
		border: 1px solid color-mix(in srgb, var(--color-error) 45%, transparent);
		background: color-mix(in srgb, var(--color-error) 10%, transparent);
		color: var(--color-text-muted);
	}
	.error-state strong {
		color: var(--color-error);
	}
	.close {
		align-self: flex-start;
	}
	.connected-section {
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border);
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
	.request {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}
	.request code {
		overflow-wrap: anywhere;
		color: var(--color-text-muted);
		font-size: 0.72rem;
	}
	@media (max-width: 480px) {
		.row {
			align-items: stretch;
			flex-direction: column;
		}
		.account {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
