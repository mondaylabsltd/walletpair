<svelte:head><title>EIP-1193 and wagmi — WalletPair</title></svelte:head>

<h1>EIP-1193 and wagmi</h1>

<p>
	WalletPair does not ship a wagmi connector or provider package. Implement the Ethereum protocol
	first, then expose its dApp-side transport through your own EIP-1193-compatible provider.
</p>

<h2>Provider contract</h2>

<pre><code
		>{`interface RequestArguments {
  readonly method: string
  readonly params?: readonly unknown[] | object
}

provider.request(args): Promise<unknown>
provider.on(event, listener): Provider
provider.removeListener(event, listener): Provider`}</code
	></pre>

<p>
	Successful <code>request()</code> calls resolve to the method result itself. Failures reject with
	a <code>ProviderRpcError</code> containing the EIP-1193 numeric error code. Implement
	<code>addListener</code> as an alias of <code>on</code> and <code>once</code> for ecosystem
	compatibility; legacy <code>send</code> and <code>sendAsync</code> are out of scope.
</p>

<h2>Adapter responsibilities</h2>

<ul>
	<li>Turn each provider call into the encrypted request envelope from the Ethereum protocol.</li>
	<li>
		Route a response to its outstanding request ID and emit wallet events after local state updates.
	</li>
	<li>
		Preserve the EIP-155 suffix for responses and select the new suffix for <code>chainChanged</code
		>.
	</li>
	<li>Use a separately trusted RPC endpoint only for explicitly allowlisted read-only methods.</li>
	<li>
		Expose the provider to wagmi using the normal custom-connector integration points in the wagmi
		version you use.
	</li>
</ul>

<p>
	This separation keeps application-framework adapters out of the WalletPair wire protocol and
	avoids shipping a stale, incompatible SDK abstraction.
</p>
