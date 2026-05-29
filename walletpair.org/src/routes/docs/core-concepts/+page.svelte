<svelte:head>
	<title>Core Concepts — WalletPair</title>
</svelte:head>

<h1>Core Concepts</h1>

<p>
	WalletPair is a two-party channel protocol. One side is the dApp, the other is the wallet. They
	communicate through a relay that can only route encrypted bytes — it cannot read, forge, or
	replay application data.
</p>

<h2 id="pairing">Pairing</h2>

<p>Pairing establishes the encrypted channel:</p>

<ol>
	<li>
		<strong>dApp creates a channel.</strong> It generates an ephemeral X25519 keypair and a random
		channel ID, then sends a <code>create</code> message to the relay.
	</li>
	<li>
		<strong>dApp displays a QR code.</strong> The pairing URI encodes the channel ID, the dApp's
		public key, and the relay URL.
	</li>
	<li>
		<strong>Wallet scans the QR code.</strong> It generates its own ephemeral keypair, derives a
		shared secret via X25519, and sends a <code>join</code> message with a sealed handshake
		payload.
	</li>
	<li>
		<strong>dApp verifies the handshake.</strong> It decrypts the sealed join, derives traffic
		keys, and auto-accepts.
	</li>
	<li>
		<strong>Both sides compute a session fingerprint</strong> — a 4-digit code derived from the
		transcript. Users can compare them out-of-band to detect MITM.
	</li>
</ol>

<p>
	The dApp's public key is delivered via the QR code (a physical out-of-band channel the relay
	cannot intercept). This is the protocol's trust root.
</p>

<h2 id="encryption">Encryption</h2>

<p>All application data is end-to-end encrypted with:</p>

<ul>
	<li>
		<strong>Key exchange:</strong> X25519 ephemeral keypairs (RFC 7748, with all-zero and
		low-order point rejection)
	</li>
	<li><strong>Key derivation:</strong> HKDF-SHA256 with channel ID salt and domain-separated info</li>
	<li>
		<strong>Symmetric encryption:</strong> ChaCha20-Poly1305 AEAD with type-byte AAD
		(<code>0x01</code> request, <code>0x02</code> response, <code>0x03</code> event — prevents cross-type
		confusion)
	</li>
	<li>
		<strong>Replay protection:</strong> Per-peer monotonic sequence counters with HMAC-SHA256
		nonce derivation
	</li>
	<li>
		<strong>JSON canonicalization:</strong> RFC 8785 (JCS) ensures deterministic serialization
	</li>
</ul>

<p>
	Traffic keys are directional: the dApp-to-wallet key differs from the wallet-to-dApp key.
	Reflection attacks are impossible by design.
</p>

<h2 id="transports">Transports</h2>

<p>
	The protocol is transport-agnostic. The SDK ships with two built-in transports:
</p>

<ul>
	<li>
		<strong>WebSocket</strong> (<code>WebSocketTransport</code>) — connect through a relay server.
		Best for cross-device pairing over the internet.
	</li>
	<li>
		<strong>Bluetooth LE</strong> (<code>WebBleCentralTransport</code>) — direct device-to-device
		connection. No relay needed. Currently Chrome-only via WebBluetooth API.
	</li>
</ul>

<p>
	Both transports use identical session APIs. You can switch transports without changing application
	code.
</p>

<h2 id="channels">Channel Lifecycle</h2>

<p>A session progresses through these phases:</p>

<ol>
	<li><strong>idle</strong> — session created, not yet started</li>
	<li><strong>pairing</strong> — channel created on relay, waiting for wallet</li>
	<li><strong>connected</strong> — handshake complete, encrypted communication active</li>
	<li><strong>disconnected</strong> — transport lost, reconnection possible</li>
	<li><strong>closed</strong> — session ended, keys erased</li>
</ol>

<h2 id="multichain">Multi-Chain (CAIP-2)</h2>

<p>
	WalletPair uses <a href="https://chainagnostic.org/CAIPs/caip-2" target="_blank" rel="noopener">CAIP-2</a> chain
	identifiers. For EVM chains, the format is <code>eip155:&lt;chain_id&gt;</code>.
</p>

<ul>
	<li><code>eip155:1</code> — Ethereum Mainnet</li>
	<li><code>eip155:137</code> — Polygon</li>
	<li><code>eip155:42161</code> — Arbitrum</li>
	<li><code>eip155:8453</code> — Base</li>
</ul>

<p>
	The wallet declares supported chains in <code>capabilities.chains</code>. Chain switching happens
	via <code>wallet_switchChain</code>, and the wallet pushes a <code>chainChanged</code> event.
</p>

<h2 id="relay">The Relay</h2>

<p>
	The relay is a stateless message router. It holds channels in memory only — no persistent
	storage, no breach risk. The relay:
</p>

<ul>
	<li><strong>Cannot</strong> read encrypted payloads</li>
	<li><strong>Cannot</strong> forge peer messages (it lacks traffic keys)</li>
	<li><strong>Cannot</strong> replay messages (sequence counters prevent this)</li>
	<li><strong>Can</strong> deny service (drop or delay messages)</li>
	<li><strong>Can</strong> observe metadata (timing, message sizes, public keys)</li>
</ul>

<p>
	You can <a href="/docs/relay">self-host the relay</a> for full control, or use the public relay
	for development.
</p>
