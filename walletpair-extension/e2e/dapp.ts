// A test dApp that reaches wallets the way real applications do: viem over an
// EIP-6963 provider, TronWeb's wallet adapter for TRON, and Solana's wallet
// adapter over the Wallet Standard. e2e/run.ts drives it through window.dapp.

import { PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { StandardWalletAdapter } from '@solana/wallet-standard-wallet-adapter-base';
import { TronLinkAdapter } from '@tronweb3/tronwallet-adapter-tronlink';
import { getWallets } from '@wallet-standard/app';
import { createWalletClient, custom, type EIP1193Provider } from 'viem';
import { mainnet, polygon } from 'viem/chains';

const BLOCKHASH = 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k';
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

// ── EVM ──

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

// ── TRON ──

const tronAdapter = new TronLinkAdapter({ checkTimeout: 300, openTronLinkAppOnMobile: false, openUrlWhenWalletNotFound: false });

// ── Solana ──

function solanaAdapter(): StandardWalletAdapter {
  const wallet = getWallets()
    .get()
    .find((w) => w.name === 'WalletPair');
  if (!wallet) throw new Error('WalletPair is not a registered Wallet Standard wallet');
  return new StandardWalletAdapter({ wallet: wallet as never });
}
let solana: StandardWalletAdapter | undefined;

function solanaTransfer(payer: PublicKey): Transaction {
  return new Transaction({ feePayer: payer, recentBlockhash: BLOCKHASH }).add(
    SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey('11111111111111111111111111111112'), lamports: 1 }),
  );
}

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

  async tronConnect(): Promise<string> {
    await tronAdapter.connect();
    return tronAdapter.address!;
  },
  tronSignMessage: (message: string) => tronAdapter.signMessage(message),
  tronSignTransaction: (transaction: unknown) => tronAdapter.signTransaction(transaction as never),


  async solanaConnect(): Promise<string> {
    solana = solanaAdapter();
    await solana.connect();
    return solana.publicKey!.toBase58();
  },
  async solanaSign(): Promise<string> {
    const signed = await solana!.signTransaction!(solanaTransfer(solana!.publicKey!));
    return toBase64(signed.serialize());
  },
  async solanaSignAll(): Promise<string[]> {
    const payer = solana!.publicKey!;
    const signed = await solana!.signAllTransactions!([solanaTransfer(payer), solanaTransfer(payer)]);
    return signed.map((tx) => toBase64(tx.serialize()));
  },
  async solanaSignMessage(text: string): Promise<string> {
    return toHex(await solana!.signMessage!(new TextEncoder().encode(text)));
  },
  async solanaSend(): Promise<string> {
    const payer = solana!.publicKey!;
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: BLOCKHASH,
      instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey('11111111111111111111111111111112'), lamports: 1 })],
    }).compileToV0Message();
    const connection = { rpcEndpoint: 'https://api.devnet.solana.com', commitment: 'confirmed' };
    return solana!.sendTransaction(new VersionedTransaction(message), connection as never);
  },
};

Object.assign(window, { dapp });
