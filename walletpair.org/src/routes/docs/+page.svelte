<svelte:head>
	<title>Documentation — WalletPair</title>
</svelte:head>

<h1>WalletPair</h1>

<p>
	WalletPair lets a dApp use a Wallet on another device. It is a short list of functions, each with
	a name, an input and an output, that a dApp calls on a Wallet, and one event the Wallet sends
	back. It supports Ethereum and other EVM chains only.
</p>

<p>
	The messages travel over PeerConnect, which provides the relay, pairing, end-to-end encryption and
	reliable delivery. WalletPair runs no servers of its own.
</p>

<h2>How it works</h2>

<ol>
	<li>
		The dApp creates a PeerConnect room and shows <code>walletpair:</code> followed by the invite as a
		QR code.
	</li>
	<li>The Wallet scans it and joins the room.</li>
	<li>
		The dApp calls <code>walletpair_connect</code> with the networks it wants. The user approves in
		the Wallet, and the dApp receives the accounts and active chain of each approved network.
	</li>
	<li>
		The dApp calls functions such as <code>personal_sign</code> or
		<code>eth_sendTransaction</code>. The Wallet asks the user, then answers.
	</li>
	<li>Whenever accounts or chains change, the Wallet sends a <code>state</code> event.</li>
	<li>Either side ends the session by closing the room.</li>
</ol>

<h2>Functions</h2>

<table>
	<thead>
		<tr><th>Network</th><th>Functions</th></tr>
	</thead>
	<tbody>
		<tr>
			<td>All</td>
			<td><code>walletpair_connect</code>, <code>walletpair_cancel</code></td>
		</tr>
		<tr>
			<td>EVM</td>
			<td>
				<code>personal_sign</code>, <code>eth_signTypedData_v4</code>,
				<code>eth_sendTransaction</code>, <code>wallet_sendCalls</code>,
				<code>wallet_getCallsStatus</code>, <code>wallet_getCapabilities</code>,
				<code>wallet_switchEthereumChain</code>, <code>wallet_addEthereumChain</code>
			</td>
		</tr>
	</tbody>
</table>

<p>
	Inputs, outputs and errors are in the <a href="/docs/protocol">Protocol</a>: the
	<a href="/docs/protocol/core">Core</a> and one document per network.
</p>

<h2>Try it</h2>

<p>
	The <a href="/demo">demo</a> runs a dApp and a test-only wallet side by side in this site, connected
	through the extension, on all three networks. The <a href="/demo/wallet">demo wallet</a> also works
	on its own with any dApp in another tab.
</p>

<h2>For dApp developers</h2>

<p>
	With the <a href="/docs/install-extension">browser extension</a> installed, your dApp needs no
	changes. The extension offers an EIP-1193 provider announced through EIP-6963, the way EVM
	applications look for wallets. wagmi, viem and ethers find it like any installed wallet.
</p>

<h2>For Wallet developers</h2>

<p>
	A Wallet joins the room from the QR code with a PeerConnect client, answers the functions of the
	networks it supports, and sends the <code>state</code> event. The
	<a href="/docs/protocol">Protocol</a> is all there is to implement; its test vectors check your
	parsing and give the exact signatures to expect for fixed keys.
</p>
