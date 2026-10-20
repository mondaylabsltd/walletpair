import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	ssr: {
		noExternal: ['lucide-svelte']
	},
	server: {
		// The Protocol pages render ../spec, and the demo wallet runs the
		// extension's Wallet code: both live elsewhere in this workspace.
		fs: { allow: ['..'] }
	}
});
