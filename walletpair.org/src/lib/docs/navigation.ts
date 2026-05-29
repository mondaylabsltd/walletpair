export interface NavItem {
	title: string;
	href: string;
}

export const docsNav: NavItem[] = [
	{ title: 'Overview', href: '/docs' },
	{ title: 'Getting Started', href: '/docs/getting-started' },
	{ title: 'Core Concepts', href: '/docs/core-concepts' },
	{ title: 'dApp Integration', href: '/docs/dapp-integration' },
	{ title: 'Wallet Integration', href: '/docs/wallet-integration' },
	{ title: 'Wagmi Connector', href: '/docs/wagmi' },
	{ title: 'EVM Methods', href: '/docs/evm-methods' },
	{ title: 'Self-Hosting Relay', href: '/docs/relay' },
	{ title: 'Security', href: '/docs/security' }
];
