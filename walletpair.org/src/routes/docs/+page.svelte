<svelte:head>
	<title>Documentation — WalletPair</title>
</svelte:head>

<h1>WalletPair</h1>

<p>
	WalletPair lets a dApp use a Wallet on another device. It is a short list of functions, each with
	a name, an input and an output, that a dApp calls on a Wallet, plus two events the Wallet sends
	back.
</p>

<p>
	The messages travel over PeerConnect, which provides the relay, pairing, end-to-end encryption and
	reliable delivery. WalletPair runs no servers of its own. This version supports EVM chains only.
</p>

<h2>How it works</h2>

<ol>
	<li>
		The dApp creates a PeerConnect room and shows <code>walletpair:</code> followed by the invite as a
		QR code.
	</li>
	<li>The Wallet scans it and joins the room.</li>
	<li>
		The dApp calls <code>walletpair_connect</code>. The user approves it in the Wallet, and the dApp
		receives the accounts and the active chain.
	</li>
	<li>
		The dApp calls functions such as <code>personal_sign</code> or
		<code>eth_sendTransaction</code>. The Wallet asks the user, then answers.
	</li>
	<li>
		The Wallet sends <code>accountsChanged</code> and <code>chainChanged</code> whenever they change.
	</li>
	<li>Either side ends the session by closing the room.</li>
</ol>

<h2>Functions</h2>

<table>
	<thead>
		<tr><th>Function</th><th>Output</th></tr>
	</thead>
	<tbody>
		<tr><td><code>walletpair_connect</code></td><td>Wallet name, accounts, active chain</td></tr>
		<tr><td><code>wallet_switchEthereumChain</code></td><td><code>null</code></td></tr>
		<tr><td><code>wallet_addEthereumChain</code></td><td><code>null</code></td></tr>
		<tr><td><code>personal_sign</code></td><td>Signature</td></tr>
		<tr><td><code>eth_signTypedData_v4</code></td><td>Signature</td></tr>
		<tr><td><code>eth_sendTransaction</code></td><td>Transaction hash</td></tr>
		<tr><td><code>wallet_sendCalls</code></td><td>Call bundle ID</td></tr>
		<tr><td><code>wallet_getCallsStatus</code></td><td>Call bundle status</td></tr>
		<tr><td><code>wallet_getCapabilities</code></td><td>Capabilities per chain</td></tr>
	</tbody>
</table>

<p>
	Inputs, outputs and errors for each function are in the <a href="/docs/protocol">Protocol</a>.
</p>

<h2>For dApp developers</h2>

<p>
	With the <a href="/docs/install-extension">browser extension</a> installed, your dApp needs no
	changes. The extension is a standard EIP-1193 provider, announced through EIP-6963, so wagmi, viem
	and ethers find it like any injected wallet. To build your own dApp side instead, follow section 4
	of the <a href="/docs/protocol">Protocol</a>.
</p>

<h2>For Wallet developers</h2>

<p>
	A Wallet joins the room from the QR code with a PeerConnect client, answers the functions above
	and sends the two events. The <a href="/docs/protocol">Protocol</a> is all there is to implement.
</p>
