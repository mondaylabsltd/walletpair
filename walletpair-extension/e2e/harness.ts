// Shared by the browser runs (run.ts for Chrome, firefox.ts): the test dApp
// bundle and its server, step timing, polling, and a scriptable phone.

import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import type { Prompts } from '../test/wallet/wallet';

export const here = dirname(fileURLToPath(import.meta.url));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Dapp = Record<string, (...args: any[]) => unknown>;

export const results: { step: string; ms: number }[] = [];
export async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const value = await run();
    const ms = performance.now() - started;
    results.push({ step: name, ms });
    console.log(`  ✓ ${name} (${ms.toFixed(0)} ms)`);
    return value;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    throw error;
  }
}

export async function waitFor<T>(what: string, poll: () => Promise<T | undefined> | T | undefined, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await poll();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Scriptable phone: approves by default; `hold()` keeps the next request waiting. */
export function phone() {
  const origins: (string | undefined)[] = [];
  let holding = false;
  const prompts: Prompts = {
    connect: async (_, offered, origin) => {
      origins.push(origin);
      return offered;
    },
    approve: () => (holding ? new Promise<boolean>(() => {}) : Promise.resolve(true)),
  };
  return { prompts, origins, hold: (on: boolean) => (holding = on) };
}


/** Serves the test dApp on 127.0.0.1 and localhost (two origins, one port). */
export async function serveDapp(): Promise<{ server: Server; siteA: string; siteB: string; port: number }> {
  const bundle = await esbuild.build({
    entryPoints: [join(here, 'dapp.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
    logLevel: 'error',
  });
  const script = bundle.outputFiles[0].contents;
  const html = await readFile(join(here, 'dapp.html'));
  const server = createServer((request, response) => {
    if (request.url === '/dapp.js') response.writeHead(200, { 'content-type': 'text/javascript' }).end(script);
    else response.writeHead(200, { 'content-type': 'text/html' }).end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const siteA = `http://127.0.0.1:${port}`;
  const siteB = `http://localhost:${port}`;

  return { server, siteA, siteB, port };
}
