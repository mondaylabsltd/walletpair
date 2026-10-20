// The website's demo in a real browser: walletpair.org's /demo page served by
// workerd (the built site), the built extension in Chrome, and a PeerConnect
// relay. The test clicks through it as a visitor would: Connect in the demo
// dApp, paste the extension's link into the demo wallet, approve there, on
// all three networks.
//
//   pnpm --dir ../walletpair.org build && pnpm build
//   PEERCONNECT_RELAY_BIN=… tsx e2e/demo.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import puppeteer, { type Page } from 'puppeteer';
import { startRelay } from '../test/relay';
import { here, results, step, waitFor } from './harness';

const site = join(here, '..', '..', 'walletpair.org');

/** The built site in workerd, on a free port. */
async function startSite(): Promise<{ url: string; stop(): void }> {
  const port = 40_000 + Math.floor(Math.random() * 20_000);
  const child = spawn('npx', ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1'], { cwd: site, detached: true });
  const url = `http://127.0.0.1:${port}`;
  await waitFor('the site', () => fetch(`${url}/demo`).then((r) => r.ok || undefined, () => undefined), 90_000);
  return { url, stop: () => process.kill(-child.pid!) };
}

/** Clicks the button with this label in the demo dApp's section for a network. */
async function clickDapp(page: Page, network: string, label: string): Promise<void> {
  const clicked = await page.evaluate(
    (network, label) => {
      const section = [...document.querySelectorAll('section.network')].find((s) => s.querySelector('h3')?.textContent === network);
      const button = [...(section?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
      if (!button || button.disabled) return false;
      button.click();
      return true;
    },
    network,
    label,
  );
  assert.ok(clicked, `${network} ${label} is clickable`);
}

/** Answers the demo wallet's prompt with this title. */
async function answer(page: Page, title: string, approve = true): Promise<void> {
  await page.waitForFunction((title) => [...document.querySelectorAll('.prompt strong')].some((e) => e.textContent === title), { timeout: 20_000 }, title);
  await page.evaluate(
    (title, approve) => {
      const prompt = [...document.querySelectorAll('.prompt')].find((p) => p.querySelector('strong')?.textContent === title)!;
      (prompt.querySelector(approve ? '.approve' : '.reject') as HTMLButtonElement).click();
    },
    title,
    approve,
  );
}

/** The newest result line in the demo dApp once there are `count` of them. */
async function result(page: Page, count: number): Promise<{ text: string; verified: boolean }> {
  await page.waitForFunction((count) => document.querySelectorAll('.results li').length >= count, { timeout: 20_000 }, count);
  return page.evaluate(() => {
    const li = document.querySelector('.results li')!;
    return { text: (li.textContent ?? '').replace(/\s+/g, ' '), verified: li.classList.contains('ok') };
  });
}

async function main(): Promise<void> {
  const relay = await startRelay();
  const site = await startSite();
  const browser = await puppeteer.launch({
    headless: process.env.HEADLESS !== '0',
    pipe: true,
    enableExtensions: [join(here, '..', '.output', 'chrome-mv3')],
    protocolTimeout: 60_000,
  });
  try {
    const worker = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'));
    const extensionId = new URL(worker.url()).host;
    console.log(`Chrome ${await browser.version()}, site ${site.url} (workerd), relay ${relay.url}`);
    const panel = await browser.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const extState = () => panel.evaluate(() => chrome.runtime.sendMessage({ action: 'get-state' }));
    await panel.evaluate((url) => chrome.storage.local.set({ settings: { relayUrl: url } }), relay.url);

    const page = await browser.newPage();
    await page.goto(`${site.url}/demo`);
    await page.waitForSelector('section.network');
    await page.waitForFunction(() => !document.querySelector('section.network button.primary[disabled]'));
    let n = 0;

    console.log('Pairing');
    await step('Connect in the demo dApp; paste the link into the demo wallet; approve there', async () => {
      await clickDapp(page, 'EVM', 'Connect');
      const { uri } = await waitFor('the pairing link', async () => {
        const s = await extState();
        return s.uri ? s : undefined;
      });
      await page.type('#pairing-link', uri);
      await page.click('.pair button[type=submit]');
      await answer(page, 'Connect');
      const connected = await result(page, ++n);
      assert.match(connected.text, /EVM · Connect 0x[0-9a-f]{40} on chain 1/);
    });

    console.log('EVM');
    for (const [label, title] of [
      ['Sign message', 'Sign message'],
      ['Sign typed data', 'Sign typed data'],
    ] as const) {
      await step(`${label}: approved in the demo wallet, verified by the dApp`, async () => {
        await clickDapp(page, 'EVM', label);
        await answer(page, title);
        assert.equal((await result(page, ++n)).verified, true);
      });
    }
    await step('Send transaction and Switch network', async () => {
      await clickDapp(page, 'EVM', 'Send transaction');
      await answer(page, 'Send transaction');
      assert.match((await result(page, ++n)).text, /0x[0-9a-f]{64}/);
      await clickDapp(page, 'EVM', 'Switch network');
      await answer(page, 'Switch network');
      assert.match((await result(page, ++n)).text, /now on chain 137/);
    });
    await step('Reject in the demo wallet: the dApp gets 4001', async () => {
      await clickDapp(page, 'EVM', 'Sign message');
      await answer(page, 'Sign message', false);
      assert.match((await result(page, ++n)).text, /4001/);
    });
    await step('Switching the network in the demo wallet reaches the dApp', async () => {
      await page.select('select[aria-label="EVM network"]', 'eip155:8453');
      await page.waitForFunction(() => document.querySelector('section.network .who')?.textContent?.includes('chain 8453'));
    });

    console.log('TRON');
    await step('Connect (already approved), Sign message, Sign transaction: verified', async () => {
      await clickDapp(page, 'TRON', 'Connect');
      assert.match((await result(page, ++n)).text, /TRON · Connect T[1-9A-HJ-NP-Za-km-z]{33} on 0x2b6653dc/);
      await clickDapp(page, 'TRON', 'Sign message');
      await answer(page, 'Sign message');
      assert.equal((await result(page, ++n)).verified, true);
      await clickDapp(page, 'TRON', 'Sign transaction');
      await answer(page, 'Sign transaction');
      assert.equal((await result(page, ++n)).verified, true);
    });
    await step('Switch network (TIP-3326)', async () => {
      await clickDapp(page, 'TRON', 'Switch network');
      await answer(page, 'Switch network');
      assert.match((await result(page, ++n)).text, /now on Nile/);
    });

    console.log('Solana');
    await step('Connect, Sign message, Sign transaction: verified; Sign and send', async () => {
      await clickDapp(page, 'Solana', 'Connect');
      await result(page, ++n);
      await clickDapp(page, 'Solana', 'Sign message');
      await answer(page, 'Sign message');
      assert.equal((await result(page, ++n)).verified, true);
      await clickDapp(page, 'Solana', 'Sign transaction');
      await answer(page, 'Sign transaction');
      assert.equal((await result(page, ++n)).verified, true);
      await clickDapp(page, 'Solana', 'Sign and send');
      await answer(page, 'Send transaction');
      assert.match((await result(page, ++n)).text, /Solana · Sign and send [1-9A-HJ-NP-Za-km-z]{64,88}/);
    });

    if (process.env.SCREENSHOT) {
      await page.setViewport({ width: 1280, height: 1400 });
      await clickDapp(page, 'EVM', 'Sign message');
      await page.waitForSelector('.prompt');
      await page.screenshot({ path: process.env.SCREENSHOT, fullPage: true });
      await answer(page, 'Sign message');
      await result(page, ++n);
    }

    console.log('Reload and ending');
    await step('After a reload the demo wallet resumes its session', async () => {
      await page.reload();
      await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('Connected to the extension'), { timeout: 30_000 });
      n = 0;
      await clickDapp(page, 'EVM', 'Connect');
      await result(page, ++n);
      await clickDapp(page, 'EVM', 'Sign message');
      await answer(page, 'Sign message');
      assert.equal((await result(page, ++n)).verified, true);
    });
    await step('End session in the demo wallet ends it in the extension', async () => {
      await page.evaluate(() => (document.querySelector('.actions button.danger') as HTMLButtonElement).click());
      await waitFor('the extension to end the session', async () => (await extState()).phase === 'idle' || undefined, 30_000);
      await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('Not paired'), { timeout: 30_000 });
    });
    console.log(`\nAll ${results.length} steps passed.`);
  } finally {
    await browser.close();
    site.stop();
    relay.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
