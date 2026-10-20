// The extension in a real Firefox: the background starts, the page providers
// are injected, pairing works, each network signs, and Disconnect ends the
// session. Uses the installed Firefox (FIREFOX, default the macOS app).
//
//   WALLETPAIR_E2E=1 wxt build -b firefox && PEERCONNECT_RELAY_BIN=… tsx e2e/firefox.ts

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { PublicKey } from '@solana/web3.js';
import puppeteer from 'puppeteer';
import { TronWeb } from 'tronweb';
import { verifyMessage } from 'viem';
import { startRelay } from '../test/relay';
import { WalletDevice } from '../test/wallet/device';
import { FIREFOX_ID } from '../wxt.config';
import { here, phone, results, serveDapp, step, waitFor, type Dapp } from './harness';

declare const dapp: Dapp;
// In Firefox extension pages, `browser` is the promise-based API; `chrome` uses callbacks.

const UUID = 'a3b1c2d4-0000-4000-8000-00000000e2e0';

async function main(): Promise<void> {
  const { server, siteA } = await serveDapp();
  const relay = await startRelay();
  const browser = await puppeteer.launch({
    browser: 'firefox',
    executablePath: process.env.FIREFOX ?? '/Applications/Firefox.app/Contents/MacOS/firefox',
    headless: process.env.HEADLESS !== '0',
    extraPrefsFirefox: { 'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: UUID }) },
  });
  try {
    const id = await browser.installExtension(join(here, '..', '.output', 'firefox-mv2'));
    console.log(`${await browser.version()}, add-on ${id}, relay ${relay.url}`);

    // The popup, embedded in a web page (see wxt.config.ts: test builds only).
    const host = await browser.newPage();
    await host.goto(`${siteA}/dapp.html`);
    await host.evaluate((url) => {
      const frame = document.createElement('iframe');
      frame.src = url;
      frame.style.cssText = 'width:400px;height:600px';
      document.body.append(frame);
    }, `moz-extension://${UUID}/popup.html`);
    // BiDi reports the extension frame's URL as about:blank; it is the child frame that can reach the extension.
    const popup = await waitFor('the popup frame', async () => {
      for (const frame of host.frames()) {
        if (frame === host.mainFrame()) continue;
        if (await frame.evaluate(() => typeof (globalThis as unknown as { browser?: typeof chrome }).browser?.runtime?.sendMessage === 'function' && document.readyState === 'complete').catch(() => false)) return frame;
      }
      return undefined;
    });
    // Firefox's promise-based API is `browser`; its `chrome` uses callbacks.
    const extState = () => popup.evaluate(() => (globalThis as unknown as { browser: typeof chrome }).browser.runtime.sendMessage({ action: 'get-state' }));
    await step('the background starts and answers', async () => {
      assert.equal((await waitFor('the background', () => extState().catch(() => undefined))).phase, 'idle');
      await popup.evaluate((url) => (globalThis as unknown as { browser: typeof chrome }).browser.storage.local.set({ settings: { relayUrl: url } }), relay.url);
    });

    const page = await browser.newPage();
    await page.goto(`${siteA}/dapp.html`);
    await page.waitForFunction(() => 'dapp' in window);
    const phoneA = phone();
    let device: WalletDevice | undefined;

    const evmAddress = await step('EVM: announced, pairs from eth_requestAccounts', async () => {
      assert.ok(((await page.evaluate(() => dapp.announcedNames())) as string[]).includes('WalletPair'));
      const connecting = page.evaluate(() => dapp.evmConnect()) as Promise<string[]>;
      const state = await waitFor('the pairing URI', async () => {
        const s = await extState();
        return s.uri ? s : undefined;
      });
      device = new WalletDevice(state.uri, phoneA.prompts);
      const accounts = await connecting;
      assert.equal(accounts[0].toLowerCase(), device.evm.accounts[0]);
      return accounts[0] as `0x${string}`;
    });
    await step('EVM: personal_sign', async () => {
      const signature = (await page.evaluate(() => dapp.evmSign('hello firefox'))) as `0x${string}`;
      assert.ok(await verifyMessage({ address: evmAddress, message: 'hello firefox', signature }));
    });
    await step('TRON: TronLinkAdapter connects and signs', async () => {
      const address = (await page.evaluate(() => dapp.tronConnect())) as string;
      assert.equal(address, device!.tron.accounts[0]);
      const signature = (await page.evaluate(() => dapp.tronSignMessage('hello firefox'))) as string;
      assert.equal(await new TronWeb({ fullHost: 'http://127.0.0.1:9' }).trx.verifyMessageV2('hello firefox', signature), address);
    });
    await step('TRON: WalletPairAdapter is listed as WalletPair and signs', async () => {
      const { name, address } = (await page.evaluate(() => dapp.walletPairTronConnect())) as { name: string; address: string };
      assert.equal(name, 'WalletPair');
      assert.equal(address, device!.tron.accounts[0]);
      const signature = (await page.evaluate(() => dapp.walletPairTronSignMessage('hello walletpair'))) as string;
      assert.equal(await new TronWeb({ fullHost: 'http://127.0.0.1:9' }).trx.verifyMessageV2('hello walletpair', signature), address);
    });
    await step('Solana: wallet adapter connects and signs', async () => {
      const address = (await page.evaluate(() => dapp.solanaConnect())) as string;
      assert.equal(address, device!.solana.accounts[0]);
      const signature = Buffer.from((await page.evaluate(() => dapp.solanaSignMessage('hello firefox'))) as string, 'hex');
      const key = await crypto.subtle.importKey('raw', new PublicKey(address).toBytes() as BufferSource, 'Ed25519', false, ['verify']);
      assert.ok(await crypto.subtle.verify('Ed25519', key, signature, new TextEncoder().encode('hello firefox')));
    });
    await step('Disconnect in the popup ends the session for both', async () => {
      await host.bringToFront();
      await (await waitFor('the Disconnect button', () => popup.$('.btn-disconnect').then((b) => b ?? undefined))).click();
      await waitFor('the phone to learn it', () => device!.conn.state === 'closed', 30_000);
      assert.equal(device!.conn.reason, 'closed-by-peer');
      assert.equal((await extState()).phase, 'idle');
    });
    console.log(`\nAll ${results.length} Firefox steps passed.`);
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
