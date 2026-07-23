export interface NavItem {
	title: string;
	href: string;
	separator?: boolean;
}

export const docsNav: NavItem[] = [
	{ title: 'Overview', href: '/docs' },
	{ title: 'Install Extension', href: '/docs/install-extension' },
	{ title: 'Getting Started', href: '/docs/getting-started' },
	{ title: 'Core Concepts', href: '/docs/core-concepts' },
	{ title: 'dApp Integration', href: '/docs/dapp-integration' },
	{ title: 'Wallet Integration', href: '/docs/wallet-integration' },
	{ title: 'Self-Hosting Relay', href: '/docs/relay' },
	{ title: 'Security', href: '/docs/security' },
	{ title: 'Protocol Specifications', href: '', separator: true },
	{ title: 'Protocol Map', href: '/docs/sub-protocols' },
	{ title: 'Ethereum Protocol', href: '/docs/evm-methods' },
	{ title: 'EIP-1193 and wagmi', href: '/docs/wagmi' }
];
