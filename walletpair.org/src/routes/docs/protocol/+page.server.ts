import { renderSpec, specPages } from '$lib/spec';

export const prerender = true;

export function load() {
	const page = specPages[0];
	return { title: page.title, html: renderSpec(page) };
}
