export interface NavItem {
	title: string;
	href: string;
	indent?: boolean;
}

export const docsNav: NavItem[] = [
	{ title: 'Overview', href: '/docs' },
	{ title: 'Install Extension', href: '/docs/install-extension' },
	{ title: 'Protocol', href: '/docs/protocol' },
	{ title: 'Core', href: '/docs/protocol/core', indent: true },
	{ title: 'EVM', href: '/docs/protocol/evm', indent: true }
];
