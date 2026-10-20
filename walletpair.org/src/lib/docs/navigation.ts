export interface NavItem {
	title: string;
	href: string;
}

export const docsNav: NavItem[] = [
	{ title: 'Overview', href: '/docs' },
	{ title: 'Install Extension', href: '/docs/install-extension' },
	{ title: 'Protocol', href: '/docs/protocol' }
];
