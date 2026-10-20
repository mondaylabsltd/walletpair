<script lang="ts">
	import FeatureCard from '$lib/components/FeatureCard.svelte';
	import SequenceDiagram from '$lib/components/SequenceDiagram.svelte';
	import { Braces, Lock, Inbox, ServerOff, KeyRound, Plug, Download } from 'lucide-svelte';

	const features = [
		{
			icon: Braces,
			title: 'Just Functions',
			description: 'A short list of functions per network, each with a name, an input and an output.'
		},
		{
			icon: Plug,
			title: 'EVM, TRON and Solana',
			description: 'EIP-1193, TIP-1193 and the Wallet Standard: existing dApps work unchanged.'
		},
		{
			icon: ServerOff,
			title: 'No Servers to Run',
			description: 'WalletPair is only messages. PeerConnect relays carry them and store nothing.'
		},
		{
			icon: Lock,
			title: 'End-to-End Encrypted',
			description: 'A Noise handshake pins both sides. Relays see sizes and timing, never contents.'
		},
		{
			icon: Inbox,
			title: 'Nothing Lost',
			description: 'Requests wait while the phone is offline and arrive once, in order.'
		},
		{
			icon: KeyRound,
			title: 'Zero Registration',
			description: 'No API keys, project IDs or accounts. Scan a QR code and go.'
		}
	];

	const dappCode = `// Show the invite as a QR code
walletpair:wss://relay.example.com#q3V0…

// Then call functions
→ {"id":"1","method":"walletpair_connect","params":[{
     "name":"Example dApp","namespaces":["eip155","solana"]}]}
← {"id":"1","result":{"wallet":{"name":"Example Wallet"},
     "state":{"eip155":{"chain":"eip155:1","accounts":["0xd8da…"]},
              "solana":{"chain":"solana:5eyk…","accounts":["7S3P…"]}}}}`;

	const walletCode = `// Answer each call after asking the user
→ {"id":"2","method":"tron_signMessage",
   "params":{"account":"TLa2…","message":"68656c6c6f"}}
← {"id":"2","result":{"signature":"5d5f…1b"}}

// Tell the dApp when something changes
← {"event":"state","data":{"eip155":{"chain":"eip155:137",…}}}`;
</script>

<!-- Hero -->
<section class="hero">
	<h1 class="hero-title">WalletPair</h1>
	<p class="hero-sub">
		Connect dApps to wallets.<br />
		EVM, TRON and Solana, over an end-to-end encrypted link. No registration.
	</p>
	<div class="hero-actions">
		<a href="/docs/install-extension" class="btn btn-primary"
			><Download size={16} strokeWidth={1.5} /> Install Extension</a
		>
		<a href="/docs/protocol" class="btn btn-ghost">Read the Protocol →</a>
	</div>
</section>

<!-- Features -->
<section class="section">
	<h2 class="section-title">Why WalletPair</h2>
	<div class="features-grid">
		{#each features as f (f.title)}
			<FeatureCard title={f.title} description={f.description} icon={f.icon} />
		{/each}
	</div>
</section>

<!-- How It Works -->
<section class="section">
	<h2 class="section-title">How It Works</h2>
	<p class="section-desc">
		The dApp shows a QR code and the Wallet scans it. PeerConnect pairs them and encrypts everything
		between them. From then on the dApp calls functions and the Wallet answers.
	</p>
	<SequenceDiagram />
</section>

<!-- Dual Path -->
<section class="section">
	<h2 class="section-title">Start Integrating</h2>
	<div class="dual-grid">
		<div class="path-card">
			<h3 class="path-title">For dApp Developers</h3>
			<ul class="path-list">
				<li>With the extension installed, EVM, TRON and Solana dApps need no changes</li>
				<li>Or show the invite yourself and call the functions directly</li>
			</ul>
			<pre class="code-block"><code>{dappCode}</code></pre>
			<a href="/docs" class="path-link">Read the overview →</a>
		</div>
		<div class="path-card">
			<h3 class="path-title">For Wallet Developers</h3>
			<ul class="path-list">
				<li>Scan the QR code and join the room with PeerConnect</li>
				<li>Answer the functions of the networks you support, and send one event</li>
			</ul>
			<pre class="code-block"><code>{walletCode}</code></pre>
			<a href="/docs/protocol" class="path-link">Read the protocol →</a>
		</div>
	</div>
</section>

<style>
	/* ── Hero ── */
	.hero {
		text-align: center;
		padding: var(--space-24) var(--space-6) var(--space-16);
		max-width: var(--max-w-wide);
		margin: 0 auto;
	}

	.hero-title {
		font-family: var(--font-mono);
		font-size: 3.5rem;
		font-weight: 600;
		letter-spacing: -0.04em;
		margin-bottom: var(--space-4);
		background: linear-gradient(135deg, var(--color-text) 60%, var(--color-accent));
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.hero-sub {
		font-size: 1.25rem;
		color: var(--color-text-muted);
		line-height: 1.6;
		margin-bottom: var(--space-8);
	}

	.hero-actions {
		display: flex;
		gap: var(--space-4);
		justify-content: center;
		flex-wrap: wrap;
	}

	/* ── Buttons ── */
	.btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-6);
		border-radius: var(--radius-md);
		font-size: 0.95rem;
		font-weight: 500;
		text-decoration: none;
		transition:
			background 0.15s,
			border-color 0.15s;
	}

	.btn-primary {
		background: var(--color-accent);
		color: #fff;
	}

	.btn-primary:hover {
		background: var(--color-accent-hover);
		color: #fff;
	}

	.btn-ghost {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
	}

	.btn-ghost:hover {
		border-color: var(--color-text-subtle);
		color: var(--color-text);
	}

	/* ── Sections ── */
	.section {
		max-width: var(--max-w-wide);
		margin: 0 auto;
		padding: var(--space-16) var(--space-6) 0;
	}

	.section-title {
		font-size: 1.5rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		margin-bottom: var(--space-4);
		text-align: center;
	}

	.section-desc {
		text-align: center;
		color: var(--color-text-muted);
		max-width: 640px;
		margin: 0 auto var(--space-8);
		line-height: 1.6;
	}

	/* ── Feature Grid ── */
	.features-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-4);
	}

	@media (max-width: 768px) {
		.features-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 480px) {
		.features-grid {
			grid-template-columns: 1fr;
		}

		.hero-title {
			font-size: 2.5rem;
		}

		.hero-sub {
			font-size: 1.05rem;
		}
	}

	/* ── Dual Path ── */
	.dual-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-6);
	}

	@media (max-width: 768px) {
		.dual-grid {
			grid-template-columns: 1fr;
		}
	}

	.path-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-6);
	}

	.path-title {
		font-family: var(--font-mono);
		font-size: 1.1rem;
		font-weight: 600;
		margin-bottom: var(--space-4);
	}

	.path-list {
		list-style: none;
		padding: 0;
		margin-bottom: var(--space-4);
	}

	.path-list li {
		position: relative;
		padding-left: var(--space-4);
		margin-bottom: var(--space-2);
		font-size: 0.9rem;
		color: var(--color-text-muted);
		line-height: 1.5;
	}

	.path-list li::before {
		content: '·';
		position: absolute;
		left: 0;
		color: var(--color-accent);
		font-weight: bold;
	}

	.code-block {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-4);
		margin-bottom: var(--space-4);
		overflow-x: auto;
		font-size: 0.8rem;
		line-height: 1.5;
	}

	.code-block code {
		font-family: var(--font-mono);
		color: var(--color-text-muted);
		white-space: pre;
	}

	.path-link {
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--color-accent);
		text-decoration: none;
	}

	.path-link:hover {
		color: var(--color-accent-hover);
	}
</style>
