<script lang="ts">
	import { DAppSession, WebSocketTransport } from 'walletpair-sdk';
	import type { DAppPhase } from 'walletpair-sdk';
	import QRCode from 'qrcode';
	import MessageLog from '$lib/components/MessageLog.svelte';

	// ---------------------------------------------------------------------------
	// State
	// ---------------------------------------------------------------------------
	let relayUrl = $state('ws://localhost:8080/v1');
	let phase: DAppPhase = $state('idle');
	let pairingUri = $state('');
	let pairingCode = $state('------');
	let session: DAppSession | null = $state(null);
	let qrDataUrl = $state('');

	let method = $state('wallet_getAccounts');
	let params = $state('{}');
	let log = $state<{ dir: 'out' | 'in' | 'err'; type: string; detail: string }[]>([]);

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------
	function addLog(dir: 'out' | 'in' | 'err', type: string, detail = '') {
		log = [...log, { dir, type, detail }];
	}

	async function renderQR(text: string) {
		try {
			qrDataUrl = await QRCode.toDataURL(text, {
				width: 200,
				margin: 2,
				color: { dark: '#e6edf3', light: '#161b22' }
			});
		} catch {
			qrDataUrl = '';
		}
	}

	// ---------------------------------------------------------------------------
	// Connect
	// ---------------------------------------------------------------------------
	async function connect() {
		const transport = new WebSocketTransport(relayUrl);
		const s = new DAppSession({ transport, name: 'WalletPair dApp' });
		session = s;

		s.on('phase', (p) => {
			phase = p;
			addLog('in', 'phase', p);
		});

		s.on('pairingUri', (uri) => {
			pairingUri = uri;
			renderQR(uri);
		});

		s.on('pairingCode', (code) => {
			pairingCode = code;
			addLog('in', 'pairing_code', code);
		});

		s.on('walletJoined', ({ pubkey, capabilities }) => {
			addLog(
				'in',
				'join',
				`peer=${pubkey?.slice(0, 12)}... chains=${JSON.stringify(capabilities?.chains || [])}`
			);
		});

		s.on('response', ({ id, ok, data }) => {
			addLog('in', 'res', `id=${id} ok=${ok} ${JSON.stringify(data)}`);
		});

		s.on('event', ({ event, data }) => {
			addLog('in', 'evt', `event=${event} ${JSON.stringify(data)}`);
		});

		try {
			const uri = await s.createPairing();
			addLog('out', 'create', `ch=${s.channelId.slice(0, 12)}...`);
		} catch (e: any) {
			addLog('err', 'connect', e.message);
		}
	}

	// ---------------------------------------------------------------------------
	// Actions
	// ---------------------------------------------------------------------------
	function acceptWallet() {
		session?.acceptWallet();
		addLog('out', 'accept', '');
	}

	function rejectWallet() {
		session?.rejectWallet();
		addLog('out', 'reject', 'user_rejected');
	}

	async function sendRequest() {
		if (!session) return;
		const m = method === 'custom' ? prompt('Method name:') : method;
		if (!m) return;
		let p;
		try {
			p = JSON.parse(params);
		} catch {
			alert('Invalid JSON params');
			return;
		}
		addLog('out', 'req', `method=${m}`);
		try {
			const result = await session.request(m, Object.keys(p).length > 0 ? p : undefined);
			// response event already logged above
		} catch (e: any) {
			addLog('err', 'req_error', e.message);
		}
	}

	function sendPing() {
		session?.ping();
		addLog('out', 'ping', '');
	}

	function closeSession() {
		session?.close();
		addLog('out', 'close', 'normal');
	}

	function reset() {
		session?.destroy();
		session = null;
		phase = 'idle';
		pairingUri = '';
		pairingCode = '------';
		qrDataUrl = '';
	}

	function copyUri() {
		navigator.clipboard.writeText(pairingUri);
	}

	function onMethodChange() {
		if (method === 'wallet_signMessage') params = '{"message": "Hello WalletPair!"}';
		else params = '{}';
	}
</script>

<main>
	<header>
		<span>WalletPair &mdash; dApp</span>
		<span class="status">
			<span class="dot {phase === 'connected' ? 'connected' : phase === 'closed' ? 'closed' : phase === 'idle' ? '' : phase === 'disconnected' ? 'disconnected' : 'waiting'}"></span>
			<span>{phase.charAt(0).toUpperCase() + phase.slice(1).replace('_', ' ')}</span>
		</span>
	</header>

	<section>
		<h3>Transport</h3>
		<div class="row">
			<input bind:value={relayUrl} placeholder="ws://..." />
			{#if phase === 'idle'}
				<button class="primary" onclick={connect}>Connect</button>
			{/if}
		</div>
		{#if phase !== 'idle'}
			<button class="danger mt" onclick={reset}>Reset</button>
		{/if}
	</section>

	<section>
		<h3>Pairing</h3>
		<span class="field-label">Pairing URI (share with wallet)</span>
		{#if qrDataUrl}
			<div style="text-align:center;padding:12px 0">
				<img src={qrDataUrl} alt="QR Code" style="border-radius:8px" />
			</div>
		{/if}
		<div class="uri-box">{pairingUri || '--'}</div>
		<button onclick={copyUri} disabled={!pairingUri}>Copy URI</button>

		{#if phase === 'pending_accept'}
			<span class="field-label mt">Pairing Code (verify with wallet)</span>
			<div class="code">{pairingCode}</div>
			<div class="row mt">
				<button class="primary" onclick={acceptWallet}>Accept Wallet</button>
				<button class="danger" onclick={rejectWallet}>Reject</button>
			</div>
		{/if}
	</section>

	{#if phase === 'connected'}
		<section>
			<h3>Send Request</h3>
			<label for="method-select">Method</label>
			<select id="method-select" bind:value={method} onchange={onMethodChange}>
				<option value="wallet_getAccounts">wallet_getAccounts</option>
				<option value="wallet_signMessage">wallet_signMessage</option>
				<option value="custom">custom...</option>
			</select>
			<label for="params-input" class="mt">Params (JSON)</label>
			<textarea id="params-input" bind:value={params}></textarea>
			<div class="row mt">
				<button class="primary" onclick={sendRequest}>Send Request</button>
				<button onclick={sendPing}>Ping</button>
				<button class="danger" onclick={closeSession}>Close</button>
			</div>
		</section>
	{/if}

	<MessageLog entries={log} />
</main>
