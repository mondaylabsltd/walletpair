<script lang="ts">
	import CodeBlock from '$lib/components/CodeBlock.svelte';

	const response = `{
  "id": "req-1",
  "error": {
    "code": 4001,
    "message": "User rejected the request"
  }
}`;
</script>

<svelte:head><title>Wallet Integration — WalletPair</title></svelte:head>

<h1>Wallet Integration</h1>

<p>
	A wallet implements the pairing URI parser, relay client, encryption layer, and EIP-1193 request
	handler directly. There is no WalletPair SDK or capability negotiation message in the protocol.
</p>

<h2>Prepare and verify the pairing</h2>

<ol>
	<li>
		Require exactly one each of <code>ch</code>, <code>pubkey</code>, <code>relay</code>,
		<code>name</code>, <code>url</code>, and <code>icon</code>.
	</li>
	<li>
		Reject invalid percent encoding, non-canonical channel IDs or base64url keys, and invalid
		metadata.
	</li>
	<li>Calculate the dApp pairing code using the decoded URI values and show it to the user.</li>
	<li>
		Only after the user confirms the matching code, generate a fresh X25519 key pair and join the
		relay.
	</li>
	<li>Pin the public key from the QR URI; it is the wallet's authenticated dApp identity.</li>
</ol>

<h2>Validate every request</h2>

<p>
	Decrypt only strictly increasing frames under the dApp-to-wallet key. Validate the EIP-1193
	method, parameters, account authorization, selected chain, and all transaction or typed-data
	details before showing approval UI. Do not trust dApp-provided summaries.
</p>

<h2>Respond with EIP-1193 errors</h2>

<CodeBlock code={response} lang="json" />

<p>
	Use <code>4001</code> for a user rejection, <code>4100</code> for unauthorized access,
	<code>4200</code> for unsupported methods, and <code>4900</code>/<code>4901</code> for
	disconnection. Malformed requests use <code>-32600</code>; invalid parameters use
	<code>-32602</code>.
</p>

<h2>Preserve secrets and counters</h2>

<p>
	Erase ephemeral private, shared-secret, and root-key material as soon as the key schedule permits.
	Persist traffic-key and counter state atomically before reuse across a reconnect. Otherwise
	abandon the channel and require a new QR pairing.
</p>
