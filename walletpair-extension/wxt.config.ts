import { defineConfig } from 'wxt';

// PeerConnect runs as WebAssembly in the background, which the default
// policies of production builds do not allow everywhere.
const CSP = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';";

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: ({ browser, manifestVersion }) => ({
    name: 'WalletPair',
    description: 'Use your mobile wallet in EVM, TRON and Solana apps, over an end-to-end encrypted link.',
    permissions: ['storage', 'alarms', ...(browser === 'chrome' ? ['sidePanel'] : [])],
    host_permissions: ['<all_urls>'],
    content_security_policy: manifestVersion === 3 ? { extension_pages: CSP } : CSP,
  }),
  hooks: {
    'build:manifestGenerated': (wxt, manifest) => {
      // Chrome opens the side panel from the toolbar icon; Firefox keeps the popup.
      if (wxt.config.browser === 'chrome' && manifest.action) delete (manifest.action as { default_popup?: string }).default_popup;
    },
  },
});
