<script lang="ts">
	import CodeBlock from '$lib/components/CodeBlock.svelte';

	const buildCode = `cd walletpair-relay
cargo build --release
./target/release/walletpair-relay`;
	const connection = `ws(s)://<relay-host>/v1?ch=<channel-id>&name=<name>&url=<url>&icon=<icon-url>&pubkey=<x25519-public-key>`;
	const joined = `{
  "type": "channel_joined",
  "ch": "<channel-id>",
  "name": "Example Wallet",
  "url": "https://wallet.example",
  "icon": "https://wallet.example/icon.png",
  "pubkey": "<base64url-x25519-public-key>"
}`;
</script>

<svelte:head><title>Self-Hosting Relay — WalletPair</title></svelte:head>

<h1>Self-Hosting the Relay</h1>

<p>
	The relay is a stateless WebSocket router. It validates connection metadata, emits join events,
	and forwards application frames unchanged. It does not create channels with a separate command,
	decrypt payloads, store messages, or require a WebSocket subprotocol header.
</p>

<h2>Build from source</h2>

<CodeBlock code={buildCode} lang="bash" />

<h2>Connection</h2>

<CodeBlock code={connection} lang="text" />

<table>
	<thead><tr><th>Field</th><th>Validation</th></tr></thead>
	<tbody>
		<tr><td><code>ch</code></td><td>Exactly 64 lowercase hexadecimal characters.</td></tr>
		<tr><td><code>name</code></td><td>1–128 UTF-8 bytes; no control characters.</td></tr>
		<tr
			><td><code>url</code></td><td
				>Absolute <code>http:</code> or <code>https:</code> URL, at most 2048 UTF-8 bytes.</td
			></tr
		>
		<tr
			><td><code>icon</code></td><td>Absolute <code>https:</code> URL, at most 2048 UTF-8 bytes.</td
			></tr
		>
		<tr
			><td><code>pubkey</code></td><td
				>Canonical unpadded base64url, 32 decoded bytes, not all zero.</td
			></tr
		>
	</tbody>
</table>

<h2>Join event and routing</h2>

<p>
	After a client joins, the relay sends this JSON text frame to every active connection in that
	channel, including the new connection. A client waits for its own event before sending application
	frames.
</p>

<CodeBlock code={joined} lang="json" />

<ul>
	<li>
		Text and binary application frames are forwarded unchanged to every other active connection in
		the same channel.
	</li>
	<li>The sender does not receive its own application frame.</li>
	<li>There is no cross-channel forwarding and no replay for later joiners.</li>
</ul>

<h2>Deployment note</h2>

<p>
	Each in-memory channel must remain on one relay instance. Use TLS for public traffic and configure
	load balancing for channel affinity if you run multiple instances.
</p>
