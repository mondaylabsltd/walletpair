import { defineConfig } from 'wxt';

// PeerConnect runs as WebAssembly in the background, which the default
// policies of production builds do not allow everywhere.
const CSP = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';";

export const FIREFOX_ID = 'extension@walletpair.org';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: ({ browser, manifestVersion }) => ({
    name: 'WalletPair',
    description: 'Use your mobile wallet in EVM apps, over an end-to-end encrypted link.',
    permissions: ['storage', 'alarms', ...(browser === 'chrome' ? ['sidePanel'] : [])],
    host_permissions: ['<all_urls>'],
    content_security_policy: manifestVersion === 3 ? { extension_pages: CSP } : CSP,
    // Firefox: a fixed id keeps storage across installs; 128 runs page-world content scripts.
    ...(browser === 'firefox' ? { browser_specific_settings: { gecko: { id: FIREFOX_ID, strict_min_version: '128.0' } } } : {}),
    // Test builds only: WebDriver BiDi cannot open extension pages directly,
    // so e2e/firefox.ts reaches the popup through a page navigation.
    ...(process.env.WALLETPAIR_E2E === '1' ? { web_accessible_resources: manifestVersion === 3 ? [{ resources: ['popup.html'], matches: ['<all_urls>'] }] : ['popup.html'] } : {}),
  }),
  hooks: {
    'build:manifestGenerated': (wxt, manifest) => {
      // Chrome opens the side panel from the toolbar icon; Firefox keeps the popup.
      if (wxt.config.browser === 'chrome' && manifest.action) delete (manifest.action as { default_popup?: string }).default_popup;
    },
  },
});
