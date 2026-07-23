<script lang="ts">
	import CodeBlock from '$lib/components/CodeBlock.svelte';

	const dappFrame = `// eip155:1 request plaintext
{
  "id": "a printable-ASCII request ID",
  "method": "personal_sign",
  "params": ["0x48656c6c6f", "0x0000000000000000000000000000000000000000"]
}`;
</script>

<svelte:head><title>dApp Integration — WalletPair</title></svelte:head>

<h1>dApp Integration</h1>

<p>
	Implement the dApp endpoint directly against the three specifications. Do not depend on the
	removed package or send its former capability and handshake objects.
</p>

<h2>Pairing and relay connection</h2>

<ol>
	<li>Create a fresh X25519 private key, public key, and 32-byte lowercase-hex channel ID.</li>
	<li>
		Build the six-field QR URI in the canonical order and display the derived four-digit code.
	</li>
	<li>Connect to <code>/v1</code> using all five required query fields.</li>
	<li>Wait for the dApp's own <code>channel_joined</code> event before sending data.</li>
	<li>
		Pin the first eligible non-self <code>channel_joined</code> public key. Extra joiners are ignored.
	</li>
</ol>

<h2>Send requests</h2>

<p>
	Each request is an EIP-1193 envelope, not JSON-RPC 2.0. Its ID is a unique printable ASCII string
	of 1–128 bytes among outstanding requests. Seal it with the dApp-to-wallet key and attach the
	canonical <code>eip155:&lt;decimal&gt;</code> suffix.
</p>

<CodeBlock code={dappFrame} lang="json" />

<h2>Handle responses and events</h2>

<p>
	A response has <code>id</code> and exactly one of <code>result</code> or <code>error</code>.
	Events have <code>event</code> and <code>data</code>. Reject ambiguous envelopes. Response frames
	reuse the request's CAIP-2 suffix; a <code>chainChanged</code> event uses the new chain.
</p>

<h2>Counter persistence</h2>

<p>
	Reserve and persist each send sequence number before encryption, and persist the accepted receive
	sequence after authentication and MessagePack decoding. If key or counter state cannot be restored
	safely, close the channel and pair again with fresh keys.
</p>
