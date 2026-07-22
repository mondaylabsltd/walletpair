<svelte:head>
	<title>Security — WalletPair</title>
</svelte:head>

<h1>Security</h1>

<p>
	WalletPair is designed so that a compromised relay cannot read, forge, or replay application data.
	The protocol's security properties have been formally verified.
</p>

<h2 id="crypto">Cryptographic Stack</h2>

<table>
	<thead>
		<tr>
			<th>Layer</th>
			<th>Algorithm</th>
			<th>Notes</th>
		</tr>
	</thead>
	<tbody>
		<tr>
			<td>Key exchange</td>
			<td>X25519</td>
			<td>Ephemeral keypairs, all-zero/low-order rejection (RFC 7748 §6)</td>
		</tr>
		<tr>
			<td>Key derivation</td>
			<td>HKDF-SHA256</td>
			<td>Channel ID as salt, domain-separated info strings</td>
		</tr>
		<tr>
			<td>Encryption</td>
			<td>ChaCha20-Poly1305</td>
			<td>AEAD with type-byte AAD (0x01/0x02/0x03)</td>
		</tr>
		<tr>
			<td>Nonce derivation</td>
			<td>HMAC-SHA256</td>
			<td>HMAC(traffic_key, seq_bytes)[0:12]</td>
		</tr>
		<tr>
			<td>JSON canonical.</td>
			<td>RFC 8785 (JCS)</td>
			<td>Deterministic serialization with SHA-256 test vectors</td>
		</tr>
		<tr>
			<td>Fingerprint</td>
			<td>SHA256 mod 10000</td>
			<td>SHA256(prefix || channel_id || dapp_pubkey) mod 10000</td>
		</tr>
	</tbody>
</table>

<h2 id="formal-verification">Formal Verification</h2>

<p>
	Protocol security is proven with <strong>ProVerif</strong> under a
	<strong>Dolev-Yao attacker model</strong> — the attacker controls the relay and the entire
	network.
</p>

<table>
	<thead>
		<tr>
			<th>#</th>
			<th>Property</th>
			<th>Result</th>
		</tr>
	</thead>
	<tbody>
		<tr><td>1</td><td>Request confidentiality (dApp → Wallet)</td><td>Proven</td></tr>
		<tr><td>2</td><td>Response confidentiality (Wallet → dApp)</td><td>Proven</td></tr>
		<tr><td>3</td><td>Event confidentiality (Wallet → dApp)</td><td>Proven</td></tr>
		<tr><td>4</td><td>Request authentication (dApp → Wallet)</td><td>Proven</td></tr>
		<tr><td>5</td><td>Response authentication (Wallet → dApp)</td><td>Proven</td></tr>
		<tr><td>6</td><td>Event authentication (Wallet → dApp)</td><td>Proven</td></tr>
		<tr><td>7</td><td>Sealed join handshake authentication</td><td>Proven</td></tr>
	</tbody>
</table>

<h2 id="threat-model">Threat Model</h2>

<h3>What the relay cannot do:</h3>
<ul>
	<li>Read encrypted payloads</li>
	<li>Determine request success or failure</li>
	<li>Forge peer messages (it lacks traffic keys)</li>
	<li>Replay messages (sequence counters prevent this)</li>
	<li>Substitute the wallet's key without detection (sealed join decryption fails)</li>
</ul>

<h3>What the relay can do:</h3>
<ul>
	<li>Deny service (drop or delay messages)</li>
	<li>Observe metadata (timing, message sizes, public keys)</li>
	<li>See dApp meta in plaintext (name, URL, icon)</li>
	<li>Forge adapter-level messages (e.g., terminate)</li>
</ul>

<h2 id="mitigations">Mitigations</h2>

<ul>
	<li>
		<strong>MITM prevention:</strong> The dApp's public key is delivered via QR code (out-of-band
		physical channel). Session fingerprints provide visual verification.
	</li>
	<li>
		<strong>Replay prevention:</strong> Monotonic per-peer sequence counters. Write-ahead
		persistence ensures counter state survives crashes.
	</li>
	<li>
		<strong>Reflection attacks:</strong> Directional keys (dApp-to-wallet key ≠ wallet-to-dApp
		key) make reflection impossible.
	</li>
	<li>
		<strong>Cross-type confusion:</strong> Type-byte AAD (0x01/0x02/0x03) in AEAD prevents a
		response from being interpreted as a request.
	</li>
	<li>
		<strong>Duplicate requests:</strong> Wallet idempotency cache keyed on request ID and params
		hash.
	</li>
</ul>
