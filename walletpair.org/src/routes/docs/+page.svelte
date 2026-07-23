<svelte:head>
	<title>Documentation — WalletPair</title>
</svelte:head>

<h1>Documentation</h1>

<p>
	WalletPair is a minimal, self-sovereign protocol for connecting dApps with blockchain wallets. The
	core protocol is <strong>network-agnostic</strong> — it handles pairing, encryption, and transport.
	The current application protocol defines EIP-1193 behavior for EVM chains.
</p>

<h2>Core Protocol</h2>

<div class="cards">
	<a href="/docs/getting-started" class="doc-card">
		<h3>Getting Started</h3>
		<p>Implement the three wire specifications and run your first pairing.</p>
	</a>
	<a href="/docs/core-concepts" class="doc-card">
		<h3>Core Concepts</h3>
		<p>Pairing URI validation, directional keys, MessagePack, frames, and counters.</p>
	</a>
	<a href="/docs/dapp-integration" class="doc-card">
		<h3>dApp Integration</h3>
		<p>Full guide to integrating WalletPair into your dApp.</p>
	</a>
	<a href="/docs/wallet-integration" class="doc-card">
		<h3>Wallet Integration</h3>
		<p>Handle pairing requests and sign transactions in your wallet.</p>
	</a>
	<a href="/docs/relay" class="doc-card">
		<h3>Self-Hosting Relay</h3>
		<p>Deploy your own relay server with a single Rust binary.</p>
	</a>
	<a href="/docs/security" class="doc-card">
		<h3>Security</h3>
		<p>Cryptography, formal verification, and threat model.</p>
	</a>
</div>

<h2>Protocol Map</h2>

<p>
	WalletPair currently has three normative specifications: encryption, relay, and Ethereum. The
	Ethereum specification defines the EIP-1193 envelope carried by encrypted frames.
</p>

<div class="cards">
	<a href="/docs/sub-protocols" class="doc-card">
		<h3>Protocol Map</h3>
		<p>How the encryption, relay, and EVM specifications fit together.</p>
	</a>
	<a href="/docs/evm-methods" class="doc-card">
		<h3>Ethereum Protocol</h3>
		<p>EIP-1193 methods, events, envelope shapes, and error codes.</p>
	</a>
	<a href="/docs/wagmi" class="doc-card">
		<h3>EIP-1193 and wagmi</h3>
		<p>Compatibility guidance for adapting your own EIP-1193 provider.</p>
	</a>
</div>

<style>
	h2 {
		margin-top: var(--space-8);
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-4);
		margin-top: var(--space-4);
	}

	.doc-card {
		display: block;
		padding: var(--space-4) var(--space-6);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		text-decoration: none;
		transition: border-color 0.15s;
	}

	.doc-card:hover {
		border-color: var(--color-text-subtle);
	}

	.doc-card h3 {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: var(--space-1);
		color: var(--color-text);
	}

	.doc-card p {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		margin-bottom: 0;
	}

	@media (max-width: 640px) {
		.cards {
			grid-template-columns: 1fr;
		}
	}
</style>
