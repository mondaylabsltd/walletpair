<script lang="ts">
	import CodeBlock from '$lib/components/CodeBlock.svelte';
	import { Globe, Download, FolderOpen, Puzzle } from 'lucide-svelte';

	const cloneCode = `git clone https://github.com/atshelchin/walletpair.git
cd walletpair/walletpair-extension
pnpm install
pnpm build`;
</script>

<svelte:head>
	<title>Install Extension — WalletPair</title>
</svelte:head>

<h1>Install the Browser Extension</h1>

<p>
	The WalletPair extension bridges any dApp to your wallet through the WalletPair protocol. It is
	not yet available on the Chrome Web Store — you'll need to install it manually from GitHub.
</p>

<h2 id="option-a">Option A: Download the Pre-built Release</h2>

<ol class="install-steps">
	<li>
		<div class="step-header">
			<Download size={18} strokeWidth={1.5} />
			<strong>Download</strong>
		</div>
		<p>
			Go to the
			<a href="https://github.com/atshelchin/walletpair/releases" target="_blank" rel="noopener">
				GitHub Releases
			</a>
			page and download the latest <code>walletpair-extension-chrome-mv3.zip</code>.
		</p>
	</li>
	<li>
		<div class="step-header">
			<FolderOpen size={18} strokeWidth={1.5} />
			<strong>Unzip</strong>
		</div>
		<p>Extract the zip file to a folder you won't accidentally delete.</p>
	</li>
	<li>
		<div class="step-header">
			<Globe size={18} strokeWidth={1.5} />
			<strong>Open Extensions Page</strong>
		</div>
		<p>
			Navigate to <code>chrome://extensions</code> in your browser and enable
			<strong>Developer mode</strong> using the toggle in the top-right corner.
		</p>
	</li>
	<li>
		<div class="step-header">
			<Puzzle size={18} strokeWidth={1.5} />
			<strong>Load Unpacked</strong>
		</div>
		<p>
			Click <strong>Load unpacked</strong> and select the folder you extracted. The WalletPair extension
			icon should now appear in your toolbar.
		</p>
	</li>
</ol>

<h2 id="option-b">Option B: Build from Source</h2>

<p>If you prefer to build from source or want the latest development version:</p>

<CodeBlock code={cloneCode} lang="bash" />

<p>
	After building, the extension will be in <code>.output/chrome-mv3/</code>. Load that folder as an
	unpacked extension following the same steps above (starting from step 3).
</p>

<h2 id="update">Updating</h2>

<p>
	When a new version is released, download or build the latest version, then go to
	<code>chrome://extensions</code> and click the reload icon on the WalletPair card. Your settings will
	be preserved.
</p>

<h2 id="next">Next Steps</h2>

<ul>
	<li>
		<a href="/docs/getting-started">Getting Started</a> — implement the protocol and connect your first
		dApp
	</li>
	<li>
		<a href="/playground">Playground</a> — test the full flow in your browser
	</li>
</ul>

<style>
	.install-steps {
		list-style: none;
		padding: 0;
		counter-reset: step;
	}

	.install-steps li {
		counter-increment: step;
		position: relative;
		padding-left: var(--space-6);
		margin-bottom: var(--space-6);
	}

	.install-steps li::before {
		content: counter(step);
		position: absolute;
		left: 0;
		top: 0;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--color-accent);
		color: #fff;
		font-size: 0.75rem;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-mono);
	}

	.step-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-text);
		margin-bottom: var(--space-1);
	}

	.step-header :global(svg) {
		color: var(--color-accent);
	}
</style>
