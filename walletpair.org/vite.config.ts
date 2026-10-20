import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	ssr: {
		noExternal: ['lucide-svelte']
	},
	server: {
		// The Protocol pages render ../spec, which lives outside this project.
		fs: { allow: ['../spec'] }
	}
});
