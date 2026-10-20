// A PeerConnect relay for tests: PEERCONNECT_RELAY (a ws:// URL of a running
// relay), or PEERCONNECT_RELAY_BIN (a peerconnect-relay binary to start).

import { spawn, type ChildProcess } from 'node:child_process';

export const relayAvailable = Boolean(process.env.PEERCONNECT_RELAY || process.env.PEERCONNECT_RELAY_BIN);

export async function startRelay(): Promise<{ url: string; stop(): void }> {
  if (process.env.PEERCONNECT_RELAY) return { url: process.env.PEERCONNECT_RELAY, stop() {} };
  const binary = process.env.PEERCONNECT_RELAY_BIN;
  if (!binary) throw new Error('Set PEERCONNECT_RELAY or PEERCONNECT_RELAY_BIN');
  const child: ChildProcess = spawn(binary, { env: { ...process.env, PEERCONNECT_LISTEN: '127.0.0.1:0' } });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relay did not start')), 10_000);
    child.on('error', reject);
    child.stderr!.on('data', (data: Buffer) => {
      const match = /listening on (\S+)/.exec(String(data));
      if (match) {
        clearTimeout(timer);
        resolve(`ws://${match[1]}`);
      }
    });
  });
  return { url, stop: () => child.kill() };
}

/** Resolves when `test` holds, checking on every event of the given types. */
export function until(target: EventTarget, types: string[], test: () => boolean, ms = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (test()) return resolve();
    const timer = setTimeout(() => {
      done();
      reject(new Error(`timed out waiting on ${types.join('/')}`));
    }, ms);
    const check = () => {
      if (!test()) return;
      done();
      resolve();
    };
    const done = () => {
      clearTimeout(timer);
      for (const type of types) target.removeEventListener(type, check);
    };
    for (const type of types) target.addEventListener(type, check);
  });
}
