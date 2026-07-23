<svelte:head><title>Ethereum Protocol — WalletPair</title></svelte:head>

<h1>Ethereum Protocol</h1>

<p>
	The Ethereum protocol exposes an EIP-1193 provider over a WalletPair encrypted channel. Frames use
	the canonical <code>eip155:&lt;decimal chain ID&gt;</code> suffix; the EIP-155 value in that suffix
	selects the request chain context and is authenticated by AEAD.
</p>

<h2>Envelope shapes</h2>

<p>
	The encrypted plaintext is a JSON value encoded with the MessagePack profile. It is not a JSON-RPC
	2.0 response object and has no <code>jsonrpc</code> field.
</p>

<pre><code
		>{`// Request (dApp → Wallet)
{ "id": "req-1", "method": "eth_getBalance", "params": ["0x…", "latest"] }

// Response (Wallet → dApp)
{ "id": "req-1", "result": "0x0" }

// Event (Wallet → dApp)
{ "event": "chainChanged", "data": "0x1" }`}</code
	></pre>

<p>
	An ID is a unique printable ASCII string of 1–128 bytes among outstanding requests. A response
	reuses the exact ID and has exactly one of <code>result</code> or <code>error</code>. The receiver
	rejects values that match more than one envelope shape.
</p>

<h2>Required methods</h2>

<table>
	<thead><tr><th>Area</th><th>Methods</th></tr></thead>
	<tbody>
		<tr
			><td>Accounts and chain</td><td
				><code>eth_requestAccounts</code>, <code>eth_accounts</code>, <code>eth_chainId</code>,
				<code>net_version</code></td
			></tr
		>
		<tr
			><td>Permissions and network</td><td
				><code>wallet_switchEthereumChain</code>, <code>wallet_addEthereumChain</code>,
				<code>wallet_getPermissions</code>, <code>wallet_requestPermissions</code></td
			></tr
		>
		<tr
			><td>Signing and sending</td><td
				><code>eth_sendTransaction</code>, <code>personal_sign</code>,
				<code>eth_signTypedData</code>
				and v1/v3/v4, <code>wallet_sendCalls</code>, <code>wallet_getCallsStatus</code></td
			></tr
		>
	</tbody>
</table>

<p>
	EIP-5792 support also requires <code>wallet_getCapabilities</code>. Wallets may serve the listed
	read-only RPC methods locally or through a trusted endpoint, but must never blindly forward
	unknown methods or infer safety from an <code>eth_</code> prefix.
</p>

<h2>Events</h2>

<table>
	<thead><tr><th>Event</th><th>Data</th></tr></thead>
	<tbody>
		<tr><td><code>connect</code></td><td><code>{`{ chainId: "0x1" }`}</code></td></tr>
		<tr><td><code>disconnect</code></td><td>An EIP-1193 <code>ProviderRpcError</code></td></tr>
		<tr><td><code>chainChanged</code></td><td>New canonical hexadecimal chain ID</td></tr>
		<tr
			><td><code>accountsChanged</code></td><td>The complete <code>eth_accounts</code> array</td
			></tr
		>
		<tr><td><code>message</code></td><td><code>{`{ type: string, data: unknown }`}</code></td></tr>
	</tbody>
</table>

<h2>Errors</h2>

<table>
	<thead><tr><th>Code</th><th>Meaning</th></tr></thead>
	<tbody>
		<tr><td><code>4001</code></td><td>User rejected the request.</td></tr>
		<tr><td><code>4100</code></td><td>Method or account is not authorized.</td></tr>
		<tr><td><code>4200</code></td><td>Method is not supported.</td></tr>
		<tr
			><td><code>4900</code> / <code>4901</code></td><td
				>Provider or requested chain is disconnected.</td
			></tr
		>
		<tr
			><td><code>-32600</code> / <code>-32602</code> / <code>-32603</code></td><td
				>Malformed request, invalid parameters, or internal failure.</td
			></tr
		>
	</tbody>
</table>

<h2>Wallet security requirements</h2>

<ul>
	<li>Authorize accounts per paired dApp origin; do not expose accounts before approval.</li>
	<li>
		Validate actual decoded account, chain, value, target, calldata, and typed-data domain before
		signing.
	</li>
	<li>
		Reject a signing address that is not currently authorized and warn on EIP-712 domain-chain
		conflicts.
	</li>
	<li>Validate chain metadata and RPC URLs independently; they are untrusted dApp input.</li>
	<li>
		Return a <code>-32005</code> limit error when a valid response exceeds the 64 KiB plaintext bound.
	</li>
</ul>
