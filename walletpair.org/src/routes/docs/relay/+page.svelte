<script lang="ts">
	import CodeBlock from '$lib/components/CodeBlock.svelte';

	const buildCode = `cd walletpair-websocket-relay
cargo build --release
./target/release/walletpair-relay --config config.toml`;

	const configCode = `[server]
host = "0.0.0.0"
port = 8080

[limits]
max_channels = 10000

[rate_limit]
# Per-IP rate limiting
enabled = true`;
</script>

<svelte:head>
	<title>Self-Hosting Relay — WalletPair</title>
</svelte:head>

<h1>Self-Hosting the Relay</h1>

<p>
	The relay is a lightweight Rust binary that routes encrypted messages between peers. It holds
	channels in memory only — no database, no persistent storage, no breach risk.
</p>

<h2 id="build">Build from Source</h2>

<CodeBlock code={buildCode} lang="bash" />

<h2 id="config">Configuration</h2>

<CodeBlock code={configCode} lang="toml" filename="config.toml" />

<h2 id="endpoints">Endpoints</h2>

<table>
	<thead>
		<tr>
			<th>Path</th>
			<th>Purpose</th>
		</tr>
	</thead>
	<tbody>
		<tr>
			<td><code>/v1</code></td>
			<td>WebSocket endpoint (requires <code>walletpair.v1</code> subprotocol header)</td>
		</tr>
		<tr>
			<td><code>/healthz</code></td>
			<td>Liveness probe — always returns 200</td>
		</tr>
		<tr>
			<td><code>/readyz</code></td>
			<td>Readiness probe — returns 503 if at capacity</td>
		</tr>
		<tr>
			<td><code>/metrics</code></td>
			<td>Prometheus metrics export</td>
		</tr>
	</tbody>
</table>

<h2 id="deployment">Deployment</h2>

<p>The relay is a single binary with no external dependencies. Deploy it anywhere you can run a process:</p>

<ul>
	<li><strong>Docker</strong> — planned but not yet available</li>
	<li><strong>Bare metal / VM</strong> — just run the binary with a config file</li>
	<li><strong>Cloud Run / Fly.io</strong> — works well for low-ops deployment</li>
</ul>

<p>
	The relay is stateless, so horizontal scaling is straightforward: run multiple instances behind a
	load balancer. Each channel lives on a single relay instance.
</p>

<h2 id="security">Security Notes</h2>

<ul>
	<li>The relay <strong>never</strong> sees decrypted payloads</li>
	<li>No persistent storage means no data to breach</li>
	<li>Rate limiting and channel limits protect against resource exhaustion</li>
	<li>All WebSocket connections require the <code>walletpair.v1</code> subprotocol</li>
	<li>Consider TLS termination (via reverse proxy) for production deployments</li>
</ul>
