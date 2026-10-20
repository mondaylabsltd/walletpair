// The extension with the CLI wallet as a separate process: Chrome runs the
// built extension, the test dApp uses it, and `pnpm wallet` runs in its own
// process, paired through PeerConnect. The test answers the wallet's prompts
// on its stdin, as a person would type.
//
//   PEERCONNECT_RELAY_BIN=… tsx e2e/cli.ts      (or PEERCONNECT_RELAY=wss://…)

import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { verifyMessage, verifyTypedData } from 'viem';
import { startRelay } from '../test/relay';
import { here, results, serveDapp, step, waitFor, type Dapp } from './harness';

declare const dapp: Dapp;

/** Prompts answered by every CLI wallet process in this run. */
let promptsAnswered = 0;

/** The CLI wallet process, with its output and its prompts. */
class CliWallet {
  readonly output: string[] = [];
  readonly process: ChildProcessWithoutNullStreams;
  answers: ('y' | 'n')[] = [];
  prompts = 0;

  constructor(args: string[]) {
    // node itself rather than npx, so that stopping it reaches the wallet.
    this.process = spawn(process.execPath, ['--import', 'tsx', 'test/wallet/cli.ts', ...args], { cwd: join(here, '..') });
    let buffer = '';
    this.process.stdout.on('data', (chunk: Buffer) => {
      buffer += String(chunk);
      for (let i; (i = buffer.indexOf('\n')) >= 0; ) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        this.output.push(line);
        if (process.env.VERBOSE) console.log(`    wallet| ${line}`);
        if (line.includes('approve? [y/N]')) {
          this.prompts++;
          promptsAnswered++;
          this.process.stdin.write(`${this.answers.shift() ?? 'y'}\n`);
        }
      }
    });
    this.process.stderr.on('data', (chunk: Buffer) => this.output.push(`stderr: ${chunk}`));
  }

  /** The account it printed for a namespace at startup. */
  account(namespace: string): string {
    const line = this.output.find((l) => l.trimStart().startsWith(namespace));
    if (!line) throw new Error(`no ${namespace} account printed`);
    return line.trim().split(/\s+/)[1];
  }

  type(command: string): void {
    this.process.stdin.write(`${command}\n`);
  }

  stop(): Promise<void> {
    if (this.process.exitCode !== null || this.process.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const force = setTimeout(() => this.process.kill('SIGKILL'), 3000);
      this.process.once('exit', () => {
        clearTimeout(force);
        resolve();
      });
      this.process.kill();
    });
  }
}

async function main(): Promise<void> {
  const { server, siteA } = await serveDapp();
  const relay = await startRelay();
  const state = join(mkdtempSync(join(tmpdir(), 'walletpair-cli-')), 'wallet.json');
  const browser = await puppeteer.launch({
    headless: process.env.HEADLESS !== '0',
    pipe: true,
    enableExtensions: [join(here, '..', '.output', 'chrome-mv3')],
    protocolTimeout: 60_000,
  });
  let wallet: CliWallet | undefined;
  try {
    const worker = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'));
    const extensionId = new URL(worker.url()).host;
    console.log(`Chrome ${await browser.version()}, relay ${relay.url}, CLI wallet state ${state}`);
    const panel = await browser.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const extState = () => panel.evaluate(() => chrome.runtime.sendMessage({ action: 'get-state' }));
    await panel.evaluate((url) => chrome.storage.local.set({ settings: { relayUrl: url } }), relay.url);

    const page = await browser.newPage();
    await page.goto(`${siteA}/dapp.html`);
    await page.waitForFunction(() => 'dapp' in window);

    console.log('Pairing');
    const evmAddress = await step('the dApp connects; the CLI wallet pairs from the link and approves in its terminal', async () => {
      const connecting = page.evaluate(() => dapp.evmConnect()) as Promise<string[]>;
      const { uri } = await waitFor('the pairing link', async () => {
        const s = await extState();
        return s.uri ? s : undefined;
      });
      wallet = new CliWallet(['--state', state, uri]);
      const accounts = await connecting;
      assert.equal(accounts[0].toLowerCase(), wallet.account('eip155'));
      assert.ok(wallet.output.some((l) => l.includes(`Connect from ${siteA}`)), 'the terminal shows the requesting site');
      return accounts[0] as `0x${string}`;
    });

    console.log('EVM');
    await step('personal_sign approved in the terminal', async () => {
      const signature = (await page.evaluate(() => dapp.evmSign('hello from the CLI'))) as `0x${string}`;
      assert.ok(await verifyMessage({ address: evmAddress, message: 'hello from the CLI', signature }));
      assert.ok(wallet!.output.some((l) => l.includes('Message: hello from the CLI')), 'the terminal shows the message as text');
    });
    await step('typed data for another chain is refused before any prompt (4901)', async () => {
      // The CLI wallet starts on Sepolia; the test dApp's domain names chain 1.
      const before = wallet!.prompts;
      assert.equal(await page.evaluate(() => (dapp.evmSignTyped() as Promise<unknown>).then(() => 0, (e: { cause?: { code?: number }; code?: number }) => e.cause?.code ?? e.code)), 4901);
      assert.equal(wallet!.prompts, before);
    });
    await step('a request rejected in the terminal reaches the dApp as 4001', async () => {
      wallet!.answers.push('n');
      assert.equal(await page.evaluate((a) => dapp.evmError('personal_sign', ['0x6e6f', a]), evmAddress), 4001);
    });
    await step('switching chains from the terminal reaches the dApp (chainChanged)', async () => {
      wallet!.type('chain eip155:1');
      await waitFor('chainChanged', async () =>
        ((await page.evaluate(() => dapp.events())) as unknown[][]).some((e) => e[0] === 'chainChanged' && e[1] === '0x1') || undefined,
      );
      const signature = (await page.evaluate(() => dapp.evmSignTyped())) as `0x${string}`;
      assert.ok(
        await verifyTypedData({
          address: evmAddress,
          domain: { name: 'E2E', version: '1', chainId: 1 },
          types: { Mail: [{ name: 'contents', type: 'string' }] },
          primaryType: 'Mail',
          message: { contents: 'Hello' },
          signature,
        }),
      );
    });
    await step('eth_sendTransaction and wallet_switchEthereumChain', async () => {
      assert.match((await page.evaluate(() => dapp.evmSend())) as string, /^0x[0-9a-f]{64}$/);
      await page.evaluate(() => dapp.evmSwitch());
      assert.equal(await page.evaluate(() => dapp.evmChainId()), 137);
    });

    console.log('Restart and ending');
    await step('the CLI wallet quits and resumes from its state file; requests still work', async () => {
      await wallet!.stop();
      await waitFor('the extension to see the wallet offline', async () => !(await extState()).online || undefined);
      wallet = new CliWallet(['--state', state, '--resume']);
      const signature = (await page.evaluate(() => dapp.evmSign('after resume'))) as `0x${string}`;
      assert.ok(await verifyMessage({ address: evmAddress, message: 'after resume', signature }));
    });
    await step('`end` in the terminal ends the session in the extension and the dApp', async () => {
      wallet!.type('end');
      await waitFor('the extension to end the session', async () => (await extState()).phase === 'idle' || undefined, 30_000);
      await waitFor('disconnect on the page', async () =>
        ((await page.evaluate(() => dapp.events())) as unknown[][]).some((e) => e[0] === 'disconnect') || undefined,
      );
    });
    console.log(`\nAll ${results.length} steps passed; the CLI wallet answered ${promptsAnswered} prompts in its terminal.`);
  } catch (error) {
    console.log(`\n--- CLI wallet output ---\n${wallet?.output.slice(-40).join('\n')}`);
    throw error;
  } finally {
    await wallet?.stop().catch(() => {});
    await browser.close();
    relay.stop();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
