<footer class="footer">
	<div class="footer-inner">
		<span class="copyright">WalletPair Protocol</span>
		<nav class="footer-nav">
			<a href="https://github.com/atshelchin/walletpair" target="_blank" rel="noopener">GitHub</a>
			<span class="sep">·</span>
			<a href="/docs">Docs</a>
			<span class="sep">·</span>
			<span class="license">MIT License</span>
		</nav>
	</div>
</footer>

<style>
	.footer {
		border-top: 1px solid var(--color-border);
		margin-top: var(--space-24);
	}

	.footer-inner {
		max-width: var(--max-w-wide);
		margin: 0 auto;
		padding: var(--space-6);
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.8rem;
		color: var(--color-text-subtle);
	}

	.footer-nav {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.footer-nav a {
		color: var(--color-text-subtle);
		transition: color 0.15s;
	}

	.footer-nav a:hover {
		color: var(--color-text-muted);
	}

	.sep {
		opacity: 0.4;
	}

	@media (max-width: 640px) {
		.footer-inner {
			flex-direction: column;
			gap: var(--space-2);
		}
	}
</style>
