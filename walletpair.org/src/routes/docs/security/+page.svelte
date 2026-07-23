<svelte:head><title>Security — WalletPair</title></svelte:head>

<h1>Security</h1>

<p>
	WalletPair assumes an active attacker can control the relay. The relay can observe connection
	metadata, CAIP-2 chain suffixes, timing, and ciphertext sizes, and can drop, delay, replay,
	reorder, or inject frames. It cannot decrypt or forge an accepted encrypted frame.
</p>

<h2>Cryptographic stack</h2>

<table>
	<thead><tr><th>Layer</th><th>Construction</th></tr></thead>
	<tbody>
		<tr
			><td>Key exchange</td><td
				>Fresh X25519 key pair per channel; all-zero shared secret is rejected.</td
			></tr
		>
		<tr
			><td>Key derivation</td><td
				>HKDF-SHA256 with channel ID salt, transcript hash, and directional labels.</td
			></tr
		>
		<tr><td>Fingerprint</td><td>SHA-256 of the dApp pairing fields, reduced modulo 10,000.</td></tr>
		<tr><td>Payload</td><td>JSON-only MessagePack, bounded to 64 KiB and 64 nesting levels.</td></tr
		>
		<tr
			><td>AEAD</td><td
				>ChaCha20-Poly1305 with a 12-byte nonce of eight zero bytes plus the uint32 sequence.</td
			></tr
		>
		<tr
			><td>Additional data</td><td
				>Protocol label, channel ID, transcript hash, direction, sequence, and CAIP-2 chain ID.</td
			></tr
		>
	</tbody>
</table>

<h2>Pairing assurance and limitations</h2>

<p>
	The wallet authenticates the dApp key scanned from QR when the user compares the matching four
	digits. The code is a short human check, not cryptographic-strength authentication: a replacement
	committed before learning it has a 1/10,000 chance per attempt, while an attacker that learns it
	first can search for a collision offline. The code does not authenticate the relay or an already
	compromised dApp page.
</p>

<p>
	The dApp does not authenticate a wallet identity. It pins the first eligible non-self joiner; that
	joiner can deny service but cannot impersonate the QR-authenticated dApp to the wallet or decrypt
	the wallet's frames.
</p>

<h2>Replay protection and persistence</h2>

<p>
	Each direction has its own sequence. A sender reserves and persists the next value before
	encrypting; a receiver records it only after all parsing, AEAD, and MessagePack checks succeed.
	Counters cannot reset while traffic keys are reused. If state cannot be recovered safely, the
	channel is abandoned.
</p>

<h2>Formal verification</h2>

<p>
	The ProVerif model covers an active relay attacker, including an attacker becoming the dApp's
	first joiner. Under idealized primitives it proves collision-free wallet binding of the five dApp
	fingerprint fields, injective dApp-to-wallet message correspondence including the public CAIP-2
	suffix, and secrecy of wallet data sent immediately after pairing. It does not prove parser
	bounds, all-zero rejection, the four-digit probability bound, or persistent counter behavior.
</p>
