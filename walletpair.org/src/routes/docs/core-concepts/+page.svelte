<svelte:head><title>Core Concepts — WalletPair</title></svelte:head>

<h1>Core Concepts</h1>

<p>
	WalletPair has three specifications that work together. The relay routes public metadata and
	opaque frames; the encryption protocol authenticates and protects each frame; the Ethereum
	protocol defines the EIP-1193 messages inside those frames.
</p>

<h2>Pairing URI and trust boundary</h2>

<p>
	The dApp creates a random 32-byte channel ID and fresh X25519 key pair, then displays a QR URI
	with exactly six fields: <code>ch</code>, <code>pubkey</code>, <code>relay</code>,
	<code>name</code>,
	<code>url</code>, and <code>icon</code>. Values are percent-encoded with RFC 3986 rules. The dApp
	uses the same channel ID, public key, and metadata when it connects to the relay.
</p>

<p>
	The wallet obtains the dApp public key from the QR code and calculates a four-digit pairing code
	from the channel ID, dApp metadata, and key. After the user compares the code, the wallet pins the
	dApp key. The dApp deliberately has no matching wallet-identity guarantee: it uses the first
	eligible non-self <code>channel_joined</code> participant and ignores later participants.
</p>

<h2>Key schedule</h2>

<p>
	Each peer derives an X25519 shared secret, rejects an all-zero result, then uses HKDF-SHA256 with
	the channel ID and transcript hash. This produces independent <em>dApp-to-wallet</em> and
	<em>wallet-to-dApp</em> ChaCha20-Poly1305 keys. Shared secrets and root keys are erased after use.
</p>

<h2>Encrypted frames</h2>

<p>
	Every application frame is a MessagePack value from the JSON data model, bounded to 64 KiB and 64
	nesting levels. The on-wire text frame is:
</p>

<pre><code>base64url(uint32_be(sequence) || ciphertext_tag)@caip-2-chain-id</code></pre>

<p>
	The suffix (for example <code>eip155:1</code>) is visible to the relay but included in AEAD
	additional data. A receiver accepts only strictly increasing sequences; gaps are allowed, while
	replays and out-of-order frames are rejected after authentication succeeds.
</p>

<h2>Relay transport</h2>

<p>
	A peer connects to <code>GET /v1</code> over WebSocket with five query fields:
	<code>ch</code>, <code>name</code>, <code>url</code>, <code>icon</code>, and <code>pubkey</code>.
	The relay broadcasts a <code>channel_joined</code> JSON event to active channel members and forwards
	all later text or binary application frames unchanged to the other members.
</p>

<h2>EVM application messages</h2>

<p>
	The current application specification uses EIP-1193 envelopes. A request has <code>id</code> and
	<code>method</code>; a response has <code>id</code> and exactly one of <code>result</code> or
	<code>error</code>; an event has <code>event</code> and <code>data</code>. These are not JSON-RPC
	2.0 envelopes and never include a <code>jsonrpc</code> field.
</p>

<p>
	Read the complete <a href="/docs/evm-methods">Ethereum protocol</a> before handling signing or transaction
	requests.
</p>
