/**
 * Runs in the page (MAIN world) and offers WalletPair the way each network's
 * applications look for wallets: EIP-1193/EIP-6963 for EVM. Everything goes
 * to the extension through the content script (content.ts).
 */
import { createBridge } from '@/lib/inpage/bridge';
import { installEvmProvider } from '@/lib/inpage/evm';

export default defineContentScript({
  matches: ['<all_urls>'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    const bridge = createBridge();
    const walletpair = Object.freeze({
      ethereum: installEvmProvider(bridge),
    });
    Object.defineProperty(window, 'walletpair', { value: walletpair, configurable: true });
  },
});
