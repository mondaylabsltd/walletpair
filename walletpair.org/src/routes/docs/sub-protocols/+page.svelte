<svelte:head><title>Protocol Map — WalletPair</title></svelte:head>

<h1>Protocol Map</h1>

<p>
	WalletPair currently defines three normative protocols. They are not SDK layers and no
	capability-negotiation or generic application sub-protocol is defined.
</p>

<table>
	<thead><tr><th>Specification</th><th>Responsibility</th><th>Public data</th></tr></thead>
	<tbody>
		<tr
			><td><strong>Encryption</strong></td><td
				>QR pairing, X25519/HKDF keys, MessagePack, AEAD, replay protection</td
			><td>Channel ID, metadata, public keys, CAIP-2 suffix, timing, size</td></tr
		>
		<tr
			><td><strong>Relay</strong></td><td
				>WebSocket validation, join events, in-channel forwarding</td
			><td>Connection query fields and unchanged application frames</td></tr
		>
		<tr
			><td><strong>Ethereum</strong></td><td
				>EIP-1193 requests, responses, events, and method security rules</td
			><td>Authenticated <code>eip155:&lt;decimal&gt;</code> routing suffix</td></tr
		>
	</tbody>
</table>

<h2>How a request travels</h2>

<ol>
	<li>The dApp creates an EIP-1193 request and selects a canonical EIP-155 chain.</li>
	<li>The encryption layer MessagePack-encodes and seals it with the dApp-to-wallet key.</li>
	<li>The relay forwards the opaque <code>sealed@eip155:…</code> text frame.</li>
	<li>
		The wallet verifies the sequence and tag, decodes MessagePack, validates the request, and
		responds on the same suffix.
	</li>
</ol>

<p>
	Future chain ecosystems need their own reviewed application specification. Do not infer support
	for Solana, Sui, Bitcoin, or any other ecosystem from the chain-agnostic encryption framing alone.
</p>
