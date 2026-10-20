/**
 * Runs in the page (MAIN world) and offers WalletPair the way each network's
 * applications look for wallets: EIP-1193/EIP-6963 for EVM, TIP-1193/TIP-6963
 * and tronWeb for TRON, the Wallet Standard for Solana. Everything goes to the
 * extension through the content script (content.ts).
 */
import { createBridge } from '@/lib/inpage/bridge';
import { installEvmProvider } from '@/lib/inpage/evm';
import { installSolanaWallet } from '@/lib/inpage/solana';
import { installTron } from '@/lib/inpage/tron';

export default defineContentScript({
  matches: ['<all_urls>'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    const bridge = createBridge();
    const walletpair = Object.freeze({
      ethereum: installEvmProvider(bridge),
      tron: installTron(bridge),
      solana: installSolanaWallet(bridge),
    });
    Object.defineProperty(window, 'walletpair', { value: walletpair, configurable: true });
  },
});
