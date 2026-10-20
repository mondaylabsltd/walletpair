import { marked } from 'marked';
import spec from '../../../../../SPEC.md?raw';

// Rendered once at build time from the repository's SPEC.md, the single source of the protocol.
export const prerender = true;

export function load() {
	return { html: marked.parse(spec, { async: false }) };
}
