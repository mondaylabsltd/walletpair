// A test dApp that reaches wallets the way real applications do: viem over an
// EIP-6963 provider. e2e/run.ts drives it through window.dapp.

import { createWalletClient, custom, type EIP1193Provider } from 'viem';
import { mainnet, polygon } from 'viem/chains';

const announced: { info: { rdns: string; name: string }; provider: EIP1193Provider }[] = [];
window.addEventListener('eip6963:announceProvider', (event) => announced.push((event as CustomEvent).detail));
window.dispatchEvent(new Event('eip6963:requestProvider'));

function evmProvider(): EIP1193Provider {
  const found = announced.find((p) => p.info.rdns === 'org.walletpair.extension');
  if (!found) throw new Error('WalletPair was not announced (EIP-6963)');
  return found.provider;
}

const events: unknown[][] = [];
let evmClient: ReturnType<typeof createWalletClient> | undefined;
let evmAccount: `0x${string}` | undefined;

const dapp = {
  announcedNames: () => announced.map((p) => p.info.name),
  windowEthereumIsWalletPair: () => Boolean((window as unknown as { ethereum?: { isWalletPair?: boolean } }).ethereum?.isWalletPair),
  events: () => events,

  async evmConnect(): Promise<string[]> {
    const provider = evmProvider();
    for (const name of ['connect', 'accountsChanged', 'chainChanged', 'disconnect']) {
      provider.on(name as 'connect', (...args: unknown[]) => events.push([name, ...args.map((a) => (a instanceof Error ? (a as { code?: number }).code : a))]));
    }
    evmClient = createWalletClient({ transport: custom(provider) });
    const addresses = await evmClient.requestAddresses();
    evmAccount = addresses[0];
    return addresses;
  },
  evmChainId: () => evmClient!.getChainId(),
  evmSign: (message: string) => evmClient!.signMessage({ account: evmAccount!, message }),
  evmSignTyped: () =>
    evmClient!.signTypedData({
      account: evmAccount!,
      domain: { name: 'E2E', version: '1', chainId: 1 },
      types: { Mail: [{ name: 'contents', type: 'string' }] },
      primaryType: 'Mail',
      message: { contents: 'Hello' },
    }),
  evmSend: () =>
    evmClient!.sendTransaction({ account: evmAccount!, chain: mainnet, to: '0x000000000000000000000000000000000000dEaD', value: 1n }),
  evmSwitch: () => evmClient!.switchChain({ id: polygon.id }),
  /** Starts a signature and does not wait for it: for cancellation tests. */
  evmSignInBackground(message: string) {
    void evmClient!.signMessage({ account: evmAccount!, message }).catch(() => {});
  },
  async evmError(method: string, params: unknown[] = []): Promise<number | undefined> {
    try {
      await evmProvider().request({ method: method as 'eth_sign', params: params as never });
      return undefined;
    } catch (error) {
      return (error as { code?: number }).code;
    }
  },
};

Object.assign(window, { dapp });
