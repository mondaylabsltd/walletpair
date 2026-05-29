<script lang="ts">
	import CodeBlock from '$lib/components/CodeBlock.svelte';

	const createSession = `import { WalletSession, WebSocketTransport } from 'walletpair-sdk';

const transport = new WebSocketTransport('wss://relay.walletpair.org/v1');

const session = new WalletSession({
  transport,
  capabilities: {
    methods: [
      'wallet_getAccounts',
      'wallet_sendTransaction',
      'wallet_signMessage',
      'wallet_signTypedData',
      'wallet_switchChain',
    ],
    events: ['accountsChanged', 'chainChanged'],
    chains: ['eip155:1', 'eip155:137'],
  },
  meta: {
    name: 'My Wallet',
    description: 'A non-custodial wallet',
    url: 'https://wallet.example',
    icon: 'https://wallet.example/icon.png',
  },
});`;

	const joinCode = `// Parse the QR code / pairing URI
await session.prepareJoin(pairingUri);

// Display session fingerprint to the user for verification
console.log('Session fingerprint:', session.sessionFingerprint);

// Confirm the join (dApp auto-accepts after sealed_join verification)
await session.confirmJoin();`;

	const handleRequests = `session.on('request', async (req) => {
  console.log('Method:', req.method);
  console.log('Params:', req.params);

  switch (req.method) {
    case 'wallet_getAccounts':
      await session.approve(req.id, {
        accounts: [{ address: '0x...', chains: ['eip155:1', 'eip155:137'] }],
      });
      break;

    case 'wallet_signMessage':
      // Show confirmation UI to user
      const signature = await sign(req.params.message);
      await session.approve(req.id, { signature });
      break;

    default:
      await session.reject(req.id, {
        code: 'unsupported_method',
        message: \`Method \${req.method} not supported\`,
      });
  }
});`;

	const pushEvents = `// Notify the dApp when accounts change
session.pushEvent('accountsChanged', {
  accounts: [{ address: '0xNew...', chains: ['eip155:1'] }],
});

// Notify when chain changes
session.pushEvent('chainChanged', {
  chain: 'eip155:137',
});`;

	const persistenceCode = `const session = new WalletSession({
  transport,
  capabilities: { /* ... */ },
  persistence: {
    save: (snapshot) => secureStore.set('walletpair.session', snapshot),
    load: () => secureStore.get('walletpair.session'),
    clear: () => secureStore.delete('walletpair.session'),
  },
});`;
</script>

<svelte:head>
	<title>Wallet Integration — WalletPair</title>
</svelte:head>

<h1>Wallet Integration</h1>

<p>Guide to integrating WalletPair into your wallet application.</p>

<h2 id="create-session">Create a Session</h2>

<CodeBlock code={createSession} lang="typescript" />

<p>
	The <code>capabilities</code> object declares what your wallet supports. Only include methods your
	wallet can actually handle. <code>wallet_sendTransaction</code> is optional — cold wallets and
	hardware signers that cannot broadcast should omit it.
</p>

<h2 id="join">Join a Pairing</h2>

<CodeBlock code={joinCode} lang="typescript" />

<p>
	The two-step join (<code>prepareJoin</code> + <code>confirmJoin</code>) lets you display the
	session fingerprint before completing the handshake. The dApp auto-accepts once it verifies
	the sealed join payload.
</p>

<h2 id="handle-requests">Handle Requests</h2>

<CodeBlock code={handleRequests} lang="typescript" />

<p>
	Every request must be either approved or rejected. The wallet <strong>must</strong> display a
	confirmation UI for signing and transaction methods — never blind-sign.
</p>

<h2 id="push-events">Push Events</h2>

<CodeBlock code={pushEvents} lang="typescript" />

<p>
	Push events proactively to keep the dApp in sync. Always emit <code>chainChanged</code> after a
	<code>wallet_switchChain</code> approval.
</p>

<h2 id="persistence">Persistence</h2>

<CodeBlock code={persistenceCode} lang="typescript" />

<p>
	Use a secure storage backend (e.g., Expo SecureStore on mobile, encrypted IndexedDB on web).
	Session snapshots contain cryptographic keys and must be stored securely.
</p>

<h2 id="security">Security Requirements</h2>

<ul>
	<li>All signing methods must show a user confirmation UI</li>
	<li>Never blind-sign transactions or EIP-712 data</li>
	<li>Warn users that EIP-191 signatures are not chain-bound</li>
	<li>Detect and warn on Permit/spending-allowance patterns in EIP-712</li>
	<li>Verify that <code>chain</code> param matches <code>tx.chainId</code> when both are present</li>
</ul>
