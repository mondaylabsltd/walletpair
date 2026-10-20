import { error } from '@sveltejs/kit';
import { renderSpec, specPages } from '$lib/spec';
import type { EntryGenerator, PageServerLoad } from './$types';

export const prerender = true;

export const entries: EntryGenerator = () =>
	specPages.filter((page) => page.slug).map((page) => ({ slug: page.slug }));

export const load: PageServerLoad = ({ params }) => {
	const page = specPages.find((p) => p.slug && p.slug === params.slug);
	if (!page) error(404, 'Not found');
	return { title: page.title, html: renderSpec(page) };
};
