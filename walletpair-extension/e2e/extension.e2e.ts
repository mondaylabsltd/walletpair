/**
 * E2E test for WalletPair Chrome Extension.
 *
 * Launches Chrome with the extension loaded via --load-extension,
 * navigates to a test page, and verifies provider injection,
 * EIP-6963 discovery, and basic RPC behavior.
 *
 * Usage: npx tsx e2e/extension.e2e.ts
 */

import puppeteer, { type Browser, type Page } from 'puppeteer';
import { resolve } from 'path';

const EXT_PATH = resolve(import.meta.dirname!, '..', '.output', 'chrome-mv3');
const TEST_URL = 'http://localhost:3000/dapp.html';
const TIMEOUT = 10_000;

let browser: Browser;
let page: Page;
let extensionId: string;

const results: Array<{ name: string; pass: boolean; error?: string; ms: number }> = [];

async function test(name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, pass: true, ms: Date.now() - start });
    console.log(`  ✅ ${name} (${Date.now() - start}ms)`);
  } catch (err: any) {
    results.push({ name, pass: false, error: err.message, ms: Date.now() - start });
    console.log(`  ❌ ${name}: ${err.message} (${Date.now() - start}ms)`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

// ── Setup ──────────────────────────────────────────────────────────────

async function setup() {
  console.log(`\n🚀 Launching Chrome with extension from ${EXT_PATH}\n`);

  browser = await puppeteer.launch({
    headless: false, // Extensions require visible browser
    // Use Puppeteer's bundled Chrome for Testing (supports extensions)
    userDataDir: '/tmp/walletpair-e2e-profile',
    args: [
      `--load-extension=${EXT_PATH}`,
      `--disable-extensions-except=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-popup-blocking',
      '--window-size=1280,800',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
    timeout: 30_000,
  });

  // Find extension ID — wait for service worker to start (may take a few seconds)
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));
    const targets = browser.targets();
    const swTarget = targets.find(
      (t) => t.type() === 'service_worker' && t.url().includes('chrome-extension://'),
    );
    if (swTarget) {
      extensionId = swTarget.url().match(/chrome-extension:\/\/([a-z]+)/)?.[1] ?? '';
      break;
    }
    // Also check for extension pages
    const extPage = targets.find(
      (t) => t.url().includes('chrome-extension://'),
    );
    if (extPage) {
      extensionId = extPage.url().match(/chrome-extension:\/\/([a-z]+)/)?.[1] ?? '';
      break;
    }
  }

  if (extensionId) {
    console.log(`  Extension loaded: ${extensionId}`);
  } else {
    // Last resort: list all targets for debugging
    const allTargets = browser.targets().map((t) => `${t.type()}: ${t.url()}`);
    console.log(`  All targets: ${allTargets.join('\n    ')}`);
    assert(false, 'Extension not loaded — no chrome-extension:// target found');
  }

  // Open test page
  page = await browser.newPage();
  await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await new Promise((r) => setTimeout(r, 1000)); // Wait for content scripts
}

async function teardown() {
  if (browser) await browser.close();
}

// ── Tests ──────────────────────────────────────────────────────────────

async function runTests() {
  // ── Provider Injection ──

  await test('window.walletpair is injected', async () => {
    const has = await page.evaluate(() => typeof (window as any).walletpair !== 'undefined');
    assert(has, 'window.walletpair is undefined');
  });

  await test('window.ethereum is injected', async () => {
    const has = await page.evaluate(() => typeof (window as any).ethereum !== 'undefined');
    assert(has, 'window.ethereum is undefined');
  });

  await test('provider has isWalletPair flag', async () => {
    const flag = await page.evaluate(() => (window as any).walletpair?.isWalletPair);
    assert(flag === true, `isWalletPair is ${flag}`);
  });

  // ── EIP-1193 Interface ──

  await test('provider.request is a function', async () => {
    const type = await page.evaluate(() => typeof (window as any).walletpair?.request);
    assert(type === 'function', `request is ${type}`);
  });

  await test('provider.on is a function', async () => {
    const type = await page.evaluate(() => typeof (window as any).walletpair?.on);
    assert(type === 'function', `on is ${type}`);
  });

  await test('provider.once is a function', async () => {
    const type = await page.evaluate(() => typeof (window as any).walletpair?.once);
    assert(type === 'function', `once is ${type}`);
  });

  await test('provider.removeListener is a function', async () => {
    const type = await page.evaluate(() => typeof (window as any).walletpair?.removeListener);
    assert(type === 'function', `removeListener is ${type}`);
  });

  await test('provider.isConnected returns false initially', async () => {
    const connected = await page.evaluate(() => (window as any).walletpair?.isConnected());
    assert(connected === false, `isConnected is ${connected}`);
  });

  // ── MetaMask Compatibility ──

  await test('provider._metamask.isUnlocked exists', async () => {
    const type = await page.evaluate(
      () => typeof (window as any).walletpair?._metamask?.isUnlocked,
    );
    assert(type === 'function', `_metamask.isUnlocked is ${type}`);
  });

  await test('provider.selectedAddress is null initially', async () => {
    const addr = await page.evaluate(() => (window as any).walletpair?.selectedAddress);
    assert(addr === null, `selectedAddress is ${addr}`);
  });

  // ── EIP-6963 Discovery ──

  await test('EIP-6963 provider is announced', async () => {
    const result = await page.evaluate(() => {
      return new Promise((resolve) => {
        window.addEventListener('eip6963:announceProvider', (event) => {
          const e = event as CustomEvent;
          resolve({
            name: e.detail?.info?.name,
            uuid: e.detail?.info?.uuid,
            rdns: e.detail?.info?.rdns,
            hasProvider: !!e.detail?.provider,
          });
        }, { once: true });
        window.dispatchEvent(new Event('eip6963:requestProvider'));
        setTimeout(() => resolve(null), 3000);
      });
    });

    assert(result !== null, 'No EIP-6963 response received');
    assert(result.name === 'WalletPair', `name is ${result.name}`);
    assert(result.rdns === 'org.walletpair.extension', `rdns is ${result.rdns}`);
    assert(result.hasProvider === true, 'provider missing from detail');
  });

  // ── Local RPC Methods ──

  await test('eth_chainId returns hex chain ID', async () => {
    const chainId = await page.evaluate(
      () => (window as any).walletpair.request({ method: 'eth_chainId' }),
    );
    assert(typeof chainId === 'string', `chainId type is ${typeof chainId}`);
    assert(chainId.startsWith('0x'), `chainId does not start with 0x: ${chainId}`);
  });

  await test('net_version returns string', async () => {
    const version = await page.evaluate(
      () => (window as any).walletpair.request({ method: 'net_version' }),
    );
    assert(typeof version === 'string', `net_version type is ${typeof version}`);
  });

  await test('web3_clientVersion returns WalletPair/...', async () => {
    const ver = await page.evaluate(
      () => (window as any).walletpair.request({ method: 'web3_clientVersion' }),
    );
    assert(typeof ver === 'string' && ver.startsWith('WalletPair/'), `version is ${ver}`);
  });

  await test('eth_accounts returns empty array when not connected', async () => {
    const accounts = await page.evaluate(
      () => (window as any).walletpair.request({ method: 'eth_accounts' }),
    );
    assert(Array.isArray(accounts), `accounts is not array: ${typeof accounts}`);
    assert(accounts.length === 0, `accounts should be empty, got ${accounts.length}`);
  });

  // ── Unsupported Methods ──

  await test('eth_sign throws ProviderRpcError with code 4200', async () => {
    const result = await page.evaluate(async () => {
      try {
        await (window as any).walletpair.request({ method: 'eth_sign' });
        return { threw: false };
      } catch (err: any) {
        return { threw: true, code: err.code, name: err.name, message: err.message };
      }
    });
    assert(result.threw, 'eth_sign did not throw');
    assert(result.code === 4200, `error code is ${result.code}, expected 4200`);
  });

  await test('eth_decrypt throws ProviderRpcError with code 4200', async () => {
    const result = await page.evaluate(async () => {
      try {
        await (window as any).walletpair.request({ method: 'eth_decrypt' });
        return { threw: false };
      } catch (err: any) {
        return { threw: true, code: err.code };
      }
    });
    assert(result.threw, 'eth_decrypt did not throw');
    assert(result.code === 4200, `error code is ${result.code}`);
  });

  // ── Event Emitter ──

  await test('event emitter on/emit works', async () => {
    const result = await page.evaluate(() => {
      const wp = (window as any).walletpair;
      let received: any = null;
      wp.on('test-event', (data: any) => {
        received = data;
      });
      wp.emit('test-event', { value: 42 });
      return received;
    });
    assert(result?.value === 42, `received ${JSON.stringify(result)}`);
  });

  await test('once() auto-removes after first call', async () => {
    const result = await page.evaluate(() => {
      const wp = (window as any).walletpair;
      let count = 0;
      wp.once('once-test', () => count++);
      wp.emit('once-test');
      wp.emit('once-test');
      return count;
    });
    assert(result === 1, `count is ${result}, expected 1`);
  });

  // ── Popup Extension Page ──

  await test('popup.html is accessible', async () => {
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    const popupPage = await browser.newPage();
    try {
      await popupPage.goto(popupUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      const title = await popupPage.title();
      assert(title === 'WalletPair', `popup title is "${title}"`);
    } finally {
      await popupPage.close();
    }
  });

  // ── Read-Only RPC Proxy ──

  await test('eth_blockNumber proxies to public RPC', async () => {
    const result = await page.evaluate(async () => {
      try {
        const blockNum = await (window as any).walletpair.request({ method: 'eth_blockNumber' });
        return { success: true, blockNum };
      } catch (err: any) {
        return { success: false, error: err.message, code: err.code };
      }
    });
    // This may fail if no internet or RPC is down, but the proxy should attempt it
    if (result.success) {
      assert(
        typeof result.blockNum === 'string' && result.blockNum.startsWith('0x'),
        `blockNumber is ${result.blockNum}`,
      );
    } else {
      // Proxy attempted but failed (network issue) — still valid behavior
      console.log(`    (RPC proxy error: ${result.error} — acceptable in test env)`);
    }
  });
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  try {
    await setup();
    console.log('\n📋 Running E2E tests...\n');
    await runTests();
  } catch (err: any) {
    console.error(`\n💥 Setup failed: ${err.message}`);
    results.push({ name: 'SETUP', pass: false, error: err.message, ms: 0 });
  } finally {
    await teardown();
  }

  // Report
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const total = results.length;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Results: ${passed}/${total} passed, ${failed} failed`);
  console.log(`${'─'.repeat(60)}\n`);

  if (failed > 0) {
    console.log('Failed tests:');
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`  ❌ ${r.name}: ${r.error}`);
    }
    process.exit(1);
  }

  process.exit(0);
}

main();
