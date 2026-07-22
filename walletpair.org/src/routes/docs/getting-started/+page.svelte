<script lang="ts">
	import CodeBlock from '$lib/components/CodeBlock.svelte';

	const relayConnection = `wss://relay.example/v1?ch=<64-lowercase-hex>&name=<rfc3986>&url=<rfc3986>&icon=<rfc3986>&pubkey=<base64url-x25519>`;
	const pairingUri = `walletpair:?ch=<channel-id>&pubkey=<dapp-pubkey>&relay=<percent-encoded-wss-url>&name=<percent-encoded-name>&url=<percent-encoded-url>&icon=<percent-encoded-icon>`;
	const request = `// Plaintext before MessagePack encoding and encryption
{
  "id": "req-1",
  "method": "eth_requestAccounts",
  "params": []
}

// Encrypted relay text frame
base64url(seq_bytes || ciphertext_tag) + "@eip155:1"`;
</script>

<svelte:head><title>Getting Started — WalletPair</title></svelte:head>

<h1>Getting Started</h1>

<p>
	WalletPair is a wire protocol. There is no WalletPair SDK package to install: implement the
	<a href="/docs/core-concepts">encryption</a>, <a href="/docs/relay">relay</a>, and
	<a href="/docs/evm-methods">EVM</a> specifications in the dApp or wallet you control.
</p>

<h2>1. Run or choose a relay</h2>

<p>
	Use a WebSocket endpoint at <code>/v1</code>. The connection query has exactly five required
	fields; values are RFC 3986 percent-encoded.
</p>

<CodeBlock code={relayConnection} lang="text" />

<h2>2. Create the dApp pairing</h2>

<p>
	Generate a fresh 32-byte channel ID and X25519 key pair. The dApp metadata must be a name, an
	absolute HTTP(S) URL, and an absolute HTTPS icon URL. Put those same values in the QR URI and in
	the dApp's relay connection.
</p>

<CodeBlock code={pairingUri} lang="text" />

<h2>3. Compare the pairing code</h2>

<p>
	Both sides calculate the four-digit code from the dApp channel ID, metadata, and public key. The
	wallet must compare it with the code shown by the dApp before joining. A mismatch requires a fresh
	channel and fresh keys.
</p>

<h2>4. Encrypt EVM messages</h2>

<p>
	Derive directional traffic keys with X25519 and HKDF-SHA256. Encode the EIP-1193 envelope as the
	JSON-only MessagePack profile, then seal it with ChaCha20-Poly1305. The public chain suffix is
	authenticated additional data, not plaintext routing input.
</p>

<CodeBlock code={request} lang="text" />

<h2>Next steps</h2>

<ul>
	<li>
		<a href="/docs/core-concepts">Core Concepts</a> — exact pairing, encryption, and counter rules
	</li>
	<li>
		<a href="/docs/dapp-integration">dApp Integration</a> — dApp-side implementation checklist
	</li>
	<li>
		<a href="/docs/wallet-integration">Wallet Integration</a> — wallet-side validation and approval checklist
	</li>
	<li><a href="/playground">Playground</a> — inspect an in-browser EVM pairing</li>
</ul>
