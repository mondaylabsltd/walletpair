// Renders the protocol documents in ../spec for the site, at build time only
// (imported from +page.server.ts files that are prerendered).
import { Marked, type Tokens } from 'marked';

const REPOSITORY = 'https://github.com/mondaylabsltd/walletpair/blob/main/';

export interface SpecPage {
	slug: string;
	file: string;
	title: string;
}

export const specPages: SpecPage[] = [
	{ slug: '', file: 'README.md', title: 'Overview' },
	{ slug: 'core', file: 'core.md', title: 'Core' },
	{ slug: 'evm', file: 'networks/evm.md', title: 'EVM' }
];

const sources = import.meta.glob('../../../spec/**/*.md', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

function source(file: string): string {
	const text = sources[`../../../spec/${file}`];
	if (text === undefined) throw new Error(`spec/${file} not found`);
	return text;
}

/** GitHub's heading anchors: lowercase, punctuation dropped, spaces to hyphens. */
export function anchor(text: string): string {
	return text
		.toLowerCase()
		.replace(/<[^>]*>/g, '')
		.replace(/[^\p{L}\p{N}\s_-]/gu, '')
		.trim()
		.replace(/\s/g, '-');
}

/** Maps a link in spec/<from> to the page that shows its target. */
export function rewriteLink(href: string, from: string): string {
	if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return href;
	const [path, hash] = href.split('#', 2);
	const parts = from.split('/').slice(0, -1);
	for (const part of path.split('/')) {
		if (part === '..') parts.pop();
		else if (part !== '.' && part !== '') parts.push(part);
	}
	const target = parts.join('/');
	const page = specPages.find((p) => p.file === target);
	const base = page
		? `/docs/protocol${page.slug ? `/${page.slug}` : ''}`
		: `${REPOSITORY}${['spec', ...parts].join('/')}`;
	return hash === undefined ? base : `${base}#${hash}`;
}

export function renderSpec(page: SpecPage): string {
	const marked = new Marked({
		walkTokens(token) {
			if (token.type === 'link') token.href = rewriteLink(token.href, page.file);
		},
		renderer: {
			heading({ tokens, depth }: Tokens.Heading) {
				const html = this.parser.parseInline(tokens);
				return `<h${depth} id="${anchor(html)}">${html}</h${depth}>\n`;
			}
		}
	});
	return marked.parse(source(page.file), { async: false });
}
