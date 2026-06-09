<script lang="ts">
	import { page } from '$app/state';

	const nav = [
		{ href: '/docs', label: 'Docs' },
		{ href: '/playground', label: 'Playground' }
	];

	let mobileOpen = $state(false);
</script>

<header class="header">
	<div class="header-inner">
		<a href="/" class="logo">
			<img src="/logo.png" alt="" class="logo-icon" />
			<span class="logo-text">WalletPair</span>
		</a>

		<nav class="nav-desktop">
			{#each nav as item}
				<a
					href={item.href}
					class="nav-link"
					class:active={page.url.pathname.startsWith(item.href)}
				>
					{item.label}
				</a>
			{/each}
			<a
				href="https://github.com/atshelchin/walletpair"
				class="nav-link"
				target="_blank"
				rel="noopener"
			>
				GitHub
			</a>
		</nav>

		<button
			class="mobile-toggle"
			onclick={() => (mobileOpen = !mobileOpen)}
			aria-label="Toggle navigation"
		>
			<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
				{#if mobileOpen}
					<path d="M5 5L15 15M15 5L5 15" stroke="currentColor" stroke-width="1.5" />
				{:else}
					<path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="1.5" />
				{/if}
			</svg>
		</button>
	</div>

	{#if mobileOpen}
		<nav class="nav-mobile">
			{#each nav as item}
				<a
					href={item.href}
					class="nav-link"
					class:active={page.url.pathname.startsWith(item.href)}
					onclick={() => (mobileOpen = false)}
				>
					{item.label}
				</a>
			{/each}
			<a
				href="https://github.com/atshelchin/walletpair"
				class="nav-link"
				target="_blank"
				rel="noopener"
			>
				GitHub
			</a>
		</nav>
	{/if}
</header>

<style>
	.header {
		position: sticky;
		top: 0;
		z-index: 100;
		background: var(--color-bg);
		border-bottom: 1px solid var(--color-border);
	}

	.header-inner {
		max-width: var(--max-w-wide);
		margin: 0 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-6);
		height: 56px;
	}

	.logo {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		text-decoration: none;
		color: var(--color-text);
	}

	.logo-icon {
		width: 24px;
		height: 24px;
		border-radius: 4px;
	}

	.logo-text {
		font-family: var(--font-mono);
		font-size: 1.1rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.nav-desktop {
		display: flex;
		align-items: center;
		gap: var(--space-6);
	}

	.nav-link {
		font-size: 0.9rem;
		color: var(--color-text-muted);
		transition: color 0.15s;
		text-decoration: none;
	}

	.nav-link:hover,
	.nav-link.active {
		color: var(--color-text);
	}

	.mobile-toggle {
		display: none;
		background: none;
		border: none;
		color: var(--color-text-muted);
		padding: var(--space-2);
	}

	.nav-mobile {
		display: none;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-6);
		border-top: 1px solid var(--color-border);
	}

	@media (max-width: 640px) {
		.nav-desktop {
			display: none;
		}

		.mobile-toggle {
			display: flex;
		}

		.nav-mobile {
			display: flex;
		}
	}
</style>
