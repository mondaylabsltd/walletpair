// End to end in a real browser: Chrome runs the built extension, a test dApp
// (e2e/dapp.ts) uses it through viem, TronWeb's wallet adapter and Solana's
// wallet adapter, and the reference Wallet answers over a real PeerConnect
// relay. The test plays the phone, the side panel and the dApp.
//
//   PEERCONNECT_RELAY_BIN=…/peerconnect-relay pnpm test:e2e
//
// Needs `wxt build` first (pnpm test:e2e does it). HEADLESS=0 shows the browser.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { TronWeb, utils as tronUtils } from 'tronweb';
import { keccak256, verifyMessage, verifyTypedData } from 'viem';
import { base58Encode } from '../src/lib/walletpair/codec';
import { startRelay } from '../test/relay';
import { WalletDevice } from '../test/wallet/device';
import { here, phone, results, serveDapp, step, waitFor, type Dapp } from './harness';

const extensionPath = join(here, '..', '.output', 'chrome-mv3');

declare const dapp: Dapp;

async function main(): Promise<void> {
  const { server, siteA, siteB, port } = await serveDapp();
  const relay = await startRelay();
  const browser: Browser = await puppeteer.launch({
    headless: process.env.HEADLESS !== '0',
    pipe: true,
    enableExtensions: [extensionPath],
  });

  try {
    const worker = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'));
    const extensionId = new URL(worker.url()).host;
    console.log(`Chrome ${await browser.version()}, extension ${extensionId}, relay ${relay.url}`);

    // The side panel, opened as a tab so the test can read and click it.
    const panel = await browser.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const extState = () => panel.evaluate(() => chrome.runtime.sendMessage({ action: 'get-state' }));
    await panel.evaluate((url) => chrome.storage.local.set({ settings: { relayUrl: url } }), relay.url);

    const phoneA = phone();
    let device: WalletDevice | undefined;
    const pageA = await browser.newPage();
    await pageA.goto(`${siteA}/dapp.html`);
    await pageA.waitForFunction(() => 'dapp' in window);

    console.log('EVM');
    await step('provider announced (EIP-6963) and installed as window.ethereum', async () => {
      assert.ok(((await pageA.evaluate(() => dapp.announcedNames())) as string[]).includes('WalletPair'));
      assert.equal(await pageA.evaluate(() => dapp.windowEthereumIsWalletPair()), true);
    });
    const evmAddress = await step('eth_requestAccounts pairs; the phone sees the site', async () => {
      const connecting = pageA.evaluate(() => dapp.evmConnect()) as Promise<string[]>;
      const state = await waitFor('the pairing URI', async () => {
        const s = await extState();
        return s.phase === 'pairing' && s.uri ? s : undefined;
      });
      assert.match(state.uri, /^walletpair:ws:\/\/127\.0\.0\.1:\d+#[A-Za-z0-9_-]{86}$/);
      device = new WalletDevice(state.uri, phoneA.prompts);
      const accounts = await connecting;
      assert.equal(accounts[0].toLowerCase(), device.evm.accounts[0]);
      assert.deepEqual(phoneA.origins, [siteA]);
      return accounts[0] as `0x${string}`;
    });
    await step('personal_sign (viem verifies)', async () => {
      const signature = (await pageA.evaluate(() => dapp.evmSign('hello from e2e'))) as `0x${string}`;
      assert.ok(await verifyMessage({ address: evmAddress, message: 'hello from e2e', signature }));
    });
    await step('eth_signTypedData_v4 (viem verifies)', async () => {
      const signature = (await pageA.evaluate(() => dapp.evmSignTyped())) as `0x${string}`;
      const valid = await verifyTypedData({
        address: evmAddress,
        domain: { name: 'E2E', version: '1', chainId: 1 },
        types: { Mail: [{ name: 'contents', type: 'string' }] },
        primaryType: 'Mail',
        message: { contents: 'Hello' },
        signature,
      });
      assert.ok(valid);
    });
    await step('eth_sendTransaction returns the hash of what the Wallet signed', async () => {
      const hash = await pageA.evaluate(() => dapp.evmSend());
      assert.equal(hash, keccak256(device!.evm.sent.at(-1)!));
    });
    await step('wallet_switchEthereumChain: chainChanged before the call returns', async () => {
      await pageA.evaluate(() => dapp.evmSwitch());
      assert.equal(await pageA.evaluate(() => dapp.evmChainId()), 137);
      const events = (await pageA.evaluate(() => dapp.events())) as unknown[][];
      assert.deepEqual(events.find((e) => e[0] === 'chainChanged'), ['chainChanged', '0x89']);
    });
    await step('unsupported methods answer 4200 (eth_sign)', async () => {
      assert.equal(await pageA.evaluate(() => dapp.evmError('eth_sign', ['0x00', '0x00'])), 4200);
    });
    const latencies = await step('20 personal_sign round trips (latency)', async () => {
      return (await pageA.evaluate(async () => {
        const times: number[] = [];
        for (let i = 0; i < 20; i++) {
          const started = performance.now();
          await dapp.evmSign(`latency ${i}`);
          times.push(performance.now() - started);
        }
        return times;
      })) as number[];
    });

    console.log('TRON (TronLinkAdapter)');
    const tronAddress = await step('adapter connects; granted by the phone prompt', async () => {
      const address = (await pageA.evaluate(() => dapp.tronConnect())) as string;
      assert.equal(address, device!.tron.accounts[0]);
      assert.deepEqual((await extState()).approvals, []);
      return address;
    });
    await step('signMessage (TronWeb verifies V2)', async () => {
      const signature = (await pageA.evaluate(() => dapp.tronSignMessage('hello tron'))) as string;
      const tronWeb = new TronWeb({ fullHost: 'http://127.0.0.1:9' });
      assert.equal(await tronWeb.trx.verifyMessageV2('hello tron', signature), tronAddress);
    });
    await step('signTransaction (TronWeb-built transfer, signature recovers the owner)', async () => {
      const raw_data = {
        contract: [
          {
            parameter: {
              value: { amount: 1, owner_address: TronWeb.address.toHex(tronAddress), to_address: TronWeb.address.toHex('TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7') },
              type_url: 'type.googleapis.com/protocol.TransferContract',
            },
            type: 'TransferContract',
          },
        ],
        ref_block_bytes: '0a1b',
        ref_block_hash: '0102030405060708',
        expiration: Date.now() + 60_000,
        timestamp: Date.now(),
      };
      const pb = tronUtils.transaction.txJsonToPb({ raw_data, visible: false });
      const tx = {
        visible: false,
        txID: tronUtils.transaction.txPbToTxID(pb).replace(/^0x/, ''),
        raw_data,
        raw_data_hex: tronUtils.transaction.txPbToRawDataHex(pb).toLowerCase(),
      };
      const signed = (await pageA.evaluate((t) => dapp.tronSignTransaction(t), tx)) as { signature: string[]; txID: string };
      assert.equal(signed.signature.length, 1);
      assert.equal(TronWeb.address.fromHex(tronUtils.crypto.ecRecover(signed.txID, signed.signature[0])), tronAddress);
    });

    console.log('Solana (wallet adapter over the Wallet Standard)');
    const solanaAddress = await step('adapter connects', async () => {
      const address = (await pageA.evaluate(() => dapp.solanaConnect())) as string;
      assert.equal(address, device!.solana.accounts[0]);
      return address;
    });
    await step('signTransaction (web3.js verifies)', async () => {
      const signed = Transaction.from(Buffer.from((await pageA.evaluate(() => dapp.solanaSign())) as string, 'base64'));
      assert.ok(signed.verifySignatures());
    });
    await step('signAllTransactions: one Wallet call', async () => {
      const before = device!.wallet.received.length;
      const signed = (await pageA.evaluate(() => dapp.solanaSignAll())) as string[];
      assert.equal(signed.length, 2);
      for (const tx of signed) assert.ok(Transaction.from(Buffer.from(tx, 'base64')).verifySignatures());
      assert.equal(device!.wallet.received.length - before, 1);
    });
    await step('signMessage (Ed25519 verifies)', async () => {
      const signature = Buffer.from((await pageA.evaluate(() => dapp.solanaSignMessage('hello solana'))) as string, 'hex');
      const key = await crypto.subtle.importKey('raw', new PublicKey(solanaAddress).toBytes() as BufferSource, 'Ed25519', false, ['verify']);
      assert.ok(await crypto.subtle.verify('Ed25519', key, signature, new TextEncoder().encode('hello solana')));
    });
    await step('sendTransaction through signAndSendTransaction on devnet', async () => {
      const signature = await pageA.evaluate(() => dapp.solanaSend());
      const sent = VersionedTransaction.deserialize(device!.solana.sent.at(-1)!);
      assert.equal(signature, base58Encode(sent.signatures[0]));
    });

    console.log('Sites, cancellation, restarts');
    const pageB = await browser.newPage();
    await pageB.goto(`${siteB}/dapp.html`);
    await pageB.waitForFunction(() => 'dapp' in window);
    await step('another site waits for approval in the side panel; the user clicks Allow', async () => {
      const connecting = pageB.evaluate(() => dapp.evmConnect()) as Promise<string[]>;
      await panel.bringToFront();
      const allow = await waitFor('the Allow button', () => panel.$('.approval .allow').then((b) => b ?? undefined));
      assert.match(await panel.$eval('.approval .text', (e) => e.textContent ?? ''), new RegExp(`localhost:${port}`));
      await allow.click();
      assert.equal((await connecting)[0].toLowerCase(), device!.evm.accounts[0]);
      const sites = (await extState()).sites.map((s: { origin: string }) => s.origin).sort();
      assert.deepEqual(sites, [siteA, siteB].sort());
    });
    await step('closing a page cancels its pending request in the Wallet', async () => {
      phoneA.hold(true);
      await pageB.evaluate(() => dapp.evmSignInBackground('never answered'));
      await waitFor('the request to reach the phone', () => device!.wallet.waiting.length === 1);
      await pageB.close();
      await waitFor('the cancellation', () => device!.wallet.waiting.length === 0);
      phoneA.hold(false);
    });
    await step('the service worker restarts and comes back from storage', async () => {
      const before = device!.wallet.received.filter((r) => r.method === 'walletpair_connect').length;
      const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(extensionId));
      await (await target.worker())!.close();
      await waitFor('the worker to stop', async () =>
        !(await browser.targets()).some((t) => t.type() === 'service_worker' && t.url().includes(extensionId)) || undefined,
      );
      const signature = (await pageA.evaluate(async () => {
        // The first call may meet the old port; the provider's caller retries as a user would.
        for (let i = 0; ; i++) {
          try {
            return await dapp.evmSign('after restart');
          } catch (error) {
            if (i === 3) throw error;
            await new Promise((r) => setTimeout(r, 300));
          }
        }
      })) as `0x${string}`;
      assert.ok(await verifyMessage({ address: evmAddress, message: 'after restart', signature }));
      const after = device!.wallet.received.filter((r) => r.method === 'walletpair_connect').length;
      assert.ok(after > before, 'walletpair_connect is sent again after a restart');
    });
    await step('a request made while the phone is away is answered when it is back', async () => {
      device!.stop();
      await waitFor('the extension to see the phone offline', async () => !(await extState()).online || undefined);
      const signing = pageA.evaluate(() => dapp.evmSign('while away')) as Promise<`0x${string}`>;
      await new Promise((r) => setTimeout(r, 500));
      device!.start();
      assert.ok(await verifyMessage({ address: evmAddress, message: 'while away', signature: await signing }));
    });
    await step('Disconnect in the side panel ends the session for both', async () => {
      await panel.bringToFront();
      await (await waitFor('the Disconnect button', () => panel.$('.btn-disconnect').then((b) => b ?? undefined))).click();
      await waitFor('the phone to learn the session ended', () => device!.conn.state === 'closed', 30_000);
      assert.equal(device!.conn.reason, 'closed-by-peer');
      const events = (await pageA.evaluate(() => dapp.events())) as unknown[][];
      await waitFor('disconnect on the page', async () =>
        ((await pageA.evaluate(() => dapp.events())) as unknown[][]).some((e) => e[0] === 'disconnect' && e[1] === 4900) || undefined,
      );
      assert.ok(events);
      assert.equal((await extState()).phase, 'idle');
      await waitFor('the Pair button', () => panel.$('.btn-primary').then((b) => b ?? undefined));
    });

    const sorted = [...latencies].sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(1);
    console.log(`\npersonal_sign round trip, dApp page → extension → relay → Wallet → back, 20 sequential calls:`);
    console.log(`  p50 ${at(0.5)} ms, p95 ${at(0.95)} ms, max ${sorted.at(-1)!.toFixed(1)} ms`);
    console.log(`\nAll ${results.length} steps passed.`);
  } finally {
    await browser.close();
    relay.stop();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
