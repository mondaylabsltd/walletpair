import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	ssr: {
		noExternal: ['lucide-svelte']
	},
	server: {
		// The Protocol page renders ../SPEC.md, which lives outside this project.
		fs: { allow: ['../SPEC.md'] }
	}
});
