<script lang="ts">
	import CodeBlock from '$lib/components/CodeBlock.svelte';

	const createSession = `import { DAppSession, WebSocketTransport } from 'walletpair-sdk';

const transport = new WebSocketTransport('wss://relay.walletpair.org/v1');

const session = new DAppSession({
  transport,
  meta: {
    name: 'My dApp',
    description: 'A decentralized application',
    url: 'https://dapp.example',
    icon: 'https://dapp.example/icon.png',
  },
  methods: [
    'wallet_getAccounts',
    'wallet_sendTransaction',
    'wallet_signMessage',
    'wallet_signTypedData',
  ],
  chains: ['eip155:1', 'eip155:137'],
});`;

	const pairingCode = `// Create a pairing URI and display it as a QR code
const uri = await session.createPairing();
// uri looks like: walletpair:?ch=<id>&pubkey=<hex>&relay=wss://...

// Listen for events
session.on('sessionFingerprint', (fingerprint) => {
  // Display this 4-digit code for user verification
  showFingerprint(fingerprint);
});

session.on('phase', (phase) => {
  // 'idle' | 'pairing' | 'connected' | 'disconnected' | 'closed'
  updateUI(phase);
});`;

	const requestCode = `// Send requests to the wallet
const accounts = await session.request('wallet_getAccounts');
// { accounts: [{ address: '0x...', chains: ['eip155:1'] }] }

const signature = await session.request('wallet_signMessage', {
  chain: 'eip155:1',
  address: '0xab16a96D359eC26a11e2C2b3d8f8B8942d5Bfcdb',
  message: 'Hello from my dApp!',
});
// { signature: '0x...' }

const txHash = await session.request('wallet_sendTransaction', {
  chain: 'eip155:1',
  address: '0xab16a96D359eC26a11e2C2b3d8f8B8942d5Bfcdb',
  tx: {
    to: '0x...',
    value: '0xde0b6b3a7640000', // 1 ETH
    data: '0x',
    type: '0x2',
    chainId: '0x1',
  },
});`;

	const eventsCode = `// Listen for wallet-pushed events
session.on('event', ({ name, data }) => {
  if (name === 'accountsChanged') {
    console.log('Accounts changed:', data.accounts);
  }
  if (name === 'chainChanged') {
    console.log('Chain changed to:', data.chain);
  }
});`;

	const persistenceCode = `const session = new DAppSession({
  transport,
  meta: { name: 'My dApp' },
  persistence: {
    save: (snapshot) => localStorage.setItem('walletpair.session', snapshot),
    load: () => localStorage.getItem('walletpair.session'),
    clear: () => localStorage.removeItem('walletpair.session'),
  },
});`;

	const cleanupCode = `// Close the session gracefully
session.close();

// Or destroy (closes + erases keys)
session.destroy();`;
</script>

<svelte:head>
	<title>dApp Integration — WalletPair</title>
</svelte:head>

<h1>dApp Integration</h1>

<p>Full guide to integrating WalletPair into your dApp using the TypeScript SDK.</p>

<h2 id="create-session">Create a Session</h2>

<CodeBlock code={createSession} lang="typescript" />

<p>
	The <code>meta</code> object is shown to the wallet user during pairing. <code>methods</code> and
	<code>chains</code> declare what your dApp needs — the wallet will reject requests for methods or
	chains not in its capabilities.
</p>

<h2 id="pairing">Start Pairing</h2>

<CodeBlock code={pairingCode} lang="typescript" />

<p>
	Display the pairing URI as a QR code for the wallet to scan. Use a library like
	<code>qrcode</code> to generate it. The session fingerprint is a 4-digit code for visual MITM
	prevention.
</p>

<h2 id="requests">Send Requests</h2>

<p>
	Once connected, use <code>session.request(method, params)</code> to call wallet methods. The
	response is returned as a promise.
</p>

<CodeBlock code={requestCode} lang="typescript" />

<p>
	If the wallet rejects the request, the promise rejects with an error containing a
	<code>code</code> (e.g., <code>user_rejected</code>, <code>invalid_params</code>). See
	<a href="/docs/evm-methods">EVM Methods</a> for all methods and their parameters.
</p>

<h2 id="events">Listen for Events</h2>

<CodeBlock code={eventsCode} lang="typescript" />

<h2 id="persistence">Persistence and Reconnection</h2>

<p>
	To survive page reloads and network disconnects, provide a <code>persistence</code> adapter:
</p>

<CodeBlock code={persistenceCode} lang="typescript" />

<p>
	The SDK persists session snapshots write-ahead: it saves the sequence counter before sending or
	processing messages. On reconnect, the session resumes from the last known state.
</p>

<h2 id="cleanup">Cleanup</h2>

<CodeBlock code={cleanupCode} lang="typescript" />
