<script lang="ts">
	import CodeBlock from '$lib/components/CodeBlock.svelte';

	// Use string concat to prevent Vite from scanning template literals for imports
	const im = 'import';

	const connectorCode = `${im} { walletPair } from 'walletpair-sdk/evm/wagmi';
${im} { createConfig, http } from '@wagmi/core';
${im} { mainnet, sepolia, polygon } from '@wagmi/core/chains';

const config = createConfig({
  chains: [mainnet, sepolia, polygon],
  connectors: [
    walletPair({
      relayUrl: 'wss://relay.walletpair.org/v1',
      onPairingUri: (uri) => {
        // Display QR code
        showQRCode(uri);
      },
      onSessionFingerprint: (fingerprint) => {
        // Display fingerprint for user verification
        showFingerprint(fingerprint);
      },
    }),
  ],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
    [polygon.id]: http(),
  },
});`;

	const connectCode = `${im} { connect, disconnect, signMessage, switchChain } from '@wagmi/core';

// Connect (triggers pairing flow)
const result = await connect(config, {
  connector: config.connectors[0],
});
console.log('Connected:', result.accounts);

// Sign a message
const signature = await signMessage(config, {
  message: 'Hello from wagmi!',
});

// Switch chain
await switchChain(config, { chainId: 137 });

// Disconnect
await disconnect(config);`;

	const eventsCode = `${im} { watchAccount, watchChainId } from '@wagmi/core';

watchAccount(config, {
  onChange: (account) => {
    console.log('Account changed:', account.address);
  },
});

watchChainId(config, {
  onChange: (chainId) => {
    console.log('Chain changed:', chainId);
  },
});`;

	const eip1193Code = `${im} { WalletPairProvider } from 'walletpair-sdk/evm/eip1193';

// Create an EIP-1193 provider from an existing DAppSession
const provider = new WalletPairProvider({ session: dAppSession });

// Standard EIP-1193 interface
const accounts = await provider.request({ method: 'eth_accounts' });
const signature = await provider.request({
  method: 'personal_sign',
  params: ['0x48656c6c6f', accounts[0]],
});

// Provider events
provider.on('accountsChanged', (accounts) => { /* ... */ });
provider.on('chainChanged', (chainId) => { /* ... */ });`;
</script>

<svelte:head>
	<title>Wagmi Connector — WalletPair</title>
</svelte:head>

<h1>Wagmi Connector</h1>

<p>
	WalletPair ships a drop-in <a href="https://wagmi.sh" target="_blank" rel="noopener">wagmi</a>
	connector. If your dApp already uses wagmi, integration is a few lines.
</p>

<h2 id="setup">Setup</h2>

<CodeBlock code={connectorCode} lang="typescript" filename="wagmi.config.ts" />

<h2 id="connect">Connect and Use</h2>

<CodeBlock code={connectCode} lang="typescript" />

<p>
	When <code>connect()</code> is called, the connector creates a pairing and calls your
	<code>onPairingUri</code> callback. Display the URI as a QR code. Once the wallet scans and
	joins, the connection resolves.
</p>

<h2 id="events">Watch for Changes</h2>

<CodeBlock code={eventsCode} lang="typescript" />

<h2 id="eip1193">EIP-1193 Provider</h2>

<p>
	If you're not using wagmi, you can use the standalone EIP-1193 provider directly:
</p>

<CodeBlock code={eip1193Code} lang="typescript" />

<h2 id="rpc-routing">RPC Method Routing</h2>

<p>
	The provider only sends wallet operations (signing, accounts, chain switching) through WalletPair.
	Read-only RPC methods (<code>eth_call</code>, <code>eth_getBalance</code>, etc.) are routed to
	your dApp's own RPC provider — they never touch the wallet.
</p>
