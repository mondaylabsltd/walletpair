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
	let sessionFingerprint = $state('------');
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

	function setupSessionEvents(s: DAppSession) {
		s.on('phase', (p) => {
			phase = p;
			addLog('in', 'phase', p);
		});

		s.on('pairingUri', (uri) => {
			pairingUri = uri;
			renderQR(uri);
		});

		(s as unknown as { on: (event: string, handler: (data: string) => void) => void }).on('sessionFingerprint', (fingerprint) => {
			sessionFingerprint = fingerprint;
			addLog('in', 'session_fingerprint', fingerprint);
		});

		s.on('walletJoined', ({ pubkey, capabilities }) => {
			addLog(
				'in',
				'join',
				`peer=${pubkey?.slice(0, 12)}... chains=${JSON.stringify(capabilities?.chains || [])}`
			);
		});

		s.on('response', ({ id, ok, result }) => {
			addLog('in', 'res', `id=${id} ok=${ok} ${JSON.stringify(result)}`);
		});

		s.on('event', ({ event, data }) => {
			addLog('in', 'evt', `event=${event} ${JSON.stringify(data)}`);
		});
	}

	// ---------------------------------------------------------------------------
	// WebSocket Connect
	// ---------------------------------------------------------------------------
	async function connectWs() {
		const transport = new WebSocketTransport(relayUrl);
		const s = new DAppSession({ transport, meta: { name: 'WalletPair dApp', description: 'WalletPair example dApp', url: location.origin, icon: '' } } as ConstructorParameters<typeof DAppSession>[0]);
		session = s;
		setupSessionEvents(s);

		try {
			await s.createPairing();
			sessionFingerprint = (s as unknown as { sessionFingerprint: string }).sessionFingerprint ?? '------';
			addLog('out', 'create', `ch=${s.channelId.slice(0, 12)}...`);
		} catch (e: any) {
			addLog('err', 'connect', e.message);
		}
	}

	// ---------------------------------------------------------------------------
	// Actions
	// ---------------------------------------------------------------------------
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
			await session.request(m, Object.keys(p).length > 0 ? p : undefined);
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
		sessionFingerprint = '------';
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
		<h3>Relay</h3>
		<div class="row">
			<input bind:value={relayUrl} placeholder="ws://..." />
			{#if phase === 'idle'}
				<button class="primary" onclick={connectWs}>Connect</button>
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

		{#if sessionFingerprint !== '------'}
			<span class="field-label mt">Session Fingerprint (verify with wallet)</span>
			<div class="code">{sessionFingerprint}</div>
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
