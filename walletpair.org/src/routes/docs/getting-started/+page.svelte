<script lang="ts">
	import CodeBlock from '$lib/components/CodeBlock.svelte';

	const installCode = `# Clone the repo and link locally (SDK not yet published to npm)
git clone https://github.com/atshelchin/walletpair.git
cd walletpair/walletpair-sdk
npm install && npm link`;

	const dappCode = `import { DAppSession, WebSocketTransport } from 'walletpair-sdk';

const transport = new WebSocketTransport('wss://relay.walletpair.org/v1');
const session = new DAppSession({
  transport,
  meta: {
    name: 'My dApp',
    description: 'Example dApp',
    url: 'https://dapp.example',
    icon: 'https://dapp.example/icon.png',
  },
  methods: ['wallet_getAccounts', 'wallet_sendTransaction', 'wallet_signMessage'],
  chains: ['eip155:1', 'eip155:137'],
});

// Create pairing - display the URI as a QR code
const uri = await session.createPairing();

session.on('sessionFingerprint', (fingerprint) => {
  console.log('Session fingerprint (verify matches wallet):', fingerprint);
});

session.on('phase', async (phase) => {
  if (phase !== 'connected') return;
  const result = await session.request('wallet_getAccounts');
  console.log('Accounts:', result);
});`;

	const walletCode = `import { WalletSession, WebSocketTransport } from 'walletpair-sdk';

const transport = new WebSocketTransport('wss://relay.walletpair.org/v1');
const session = new WalletSession({
  transport,
  capabilities: {
    methods: ['wallet_getAccounts', 'wallet_sendTransaction', 'wallet_signMessage'],
    events: ['accountsChanged', 'chainChanged'],
    chains: ['eip155:1', 'eip155:137'],
  },
  meta: {
    name: 'My Wallet',
    description: 'Example wallet',
    url: 'https://wallet.example',
    icon: 'https://wallet.example/icon.png',
  },
});

// Parse the scanned QR code and join
await session.prepareJoin(pairingUri);
console.log('Session fingerprint:', session.sessionFingerprint);
await session.confirmJoin();

session.on('request', async (req) => {
  // Review and respond to requests
  await session.approve(req.id, { accounts: ['0x...'] });
});`;
</script>

<svelte:head>
	<title>Getting Started — WalletPair</title>
</svelte:head>

<h1>Getting Started</h1>

<p>Get a dApp-to-wallet connection running in under 5 minutes.</p>

<h2 id="install">Install the SDK</h2>

<CodeBlock code={installCode} lang="bash" />

<p>The SDK is not yet published to npm. Link it locally from the monorepo for now.</p>

<h2 id="start-relay">Start a Relay</h2>

<p>
	You need a relay server to route messages between peers. Use the public relay at
	<code>wss://relay.walletpair.org/v1</code> for development, or
	<a href="/docs/relay">self-host your own</a>.
</p>

<h2 id="dapp-side">dApp Side</h2>

<p>
	Create a <code>DAppSession</code>, generate a pairing URI, and display it as a QR code for the
	wallet to scan.
</p>

<CodeBlock code={dappCode} lang="typescript" filename="dapp.ts" />

<h2 id="wallet-side">Wallet Side</h2>

<p>
	Create a <code>WalletSession</code>, scan the QR code, verify the session fingerprint, and handle
	incoming requests.
</p>

<CodeBlock code={walletCode} lang="typescript" filename="wallet.ts" />

<h2 id="verify">Verify the Fingerprint</h2>

<p>
	Both the dApp and wallet derive a 4-digit session fingerprint from the handshake transcript.
	Users should visually confirm these match to prevent man-in-the-middle attacks.
</p>

<h2 id="next-steps">Next Steps</h2>

<ul>
	<li><a href="/docs/core-concepts">Core Concepts</a> — understand how the protocol works</li>
	<li>
		<a href="/docs/dapp-integration">dApp Integration</a> — full DAppSession API and patterns
	</li>
	<li>
		<a href="/docs/wallet-integration">Wallet Integration</a> — handle requests and push events
	</li>
	<li><a href="/docs/wagmi">Wagmi Connector</a> — drop-in connector for wagmi apps</li>
	<li><a href="/playground">Playground</a> — try it interactively in your browser</li>
</ul>
