import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'WalletPair',
    description: 'Bridge any dApp to your wallet via WalletPair protocol',
    permissions: ['storage', 'sidePanel'],
    host_permissions: ['<all_urls>'],
    side_panel: {
      default_path: 'sidepanel.html',
    },
    web_accessible_resources: [
      {
        resources: ['icon/*'],
        matches: ['<all_urls>'],
      },
    ],
  },
});
