// WalletPair over PeerConnect on loopback: the protocol's own cost, not a
// network's. The DApp-side client and the reference Wallet run in this process
// with the vendored PeerConnect build; the relay is a separate process.
//
//   PEERCONNECT_RELAY_BIN=…/peerconnect-relay npx tsx test/bench.ts

import { cpus, platform, release } from 'node:os';
import { connect, Room } from '../vendor/peerconnect/index.js';
import { WalletPairClient } from '../src/lib/walletpair/client';
import { namespaceRules } from '../src/lib/walletpair/networks';
import { startRelay } from './relay';
import { evmSigner } from './wallet/evm';
import { ReferenceWallet } from './wallet/wallet';

const approveAll = { connect: async (_: unknown, offered: string[]) => offered, approve: async () => true };

function summary(samples: number[]): string {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return `n=${sorted.length}  p50 ${at(0.5).toFixed(2)} ms  p95 ${at(0.95).toFixed(2)} ms  p99 ${at(0.99).toFixed(2)} ms  max ${sorted.at(-1)!.toFixed(2)} ms`;
}

async function session(relay: string) {
  const room = Room.create(relay);
  const conn = connect(room);
  const client = new WalletPairClient(conn, namespaceRules);
  const signer = evmSigner();
  const walletConn = connect(Room.join(room.invite!));
  new ReferenceWallet(walletConn, { name: 'Bench Wallet', signers: [signer], prompts: approveAll, maxWaiting: 10_000 });
  const started = performance.now();
  await client.connect({ name: 'Bench' }, ['eip155']);
  const pairing = performance.now() - started;
  return { client, account: signer.accounts[0], pairing, close: () => (conn.leave(), walletConn.leave()) };
}

async function main(): Promise<void> {
  const relay = await startRelay();
  console.log(`${cpus()[0].model}, ${cpus().length} cores, ${platform()} ${release()}, Node ${process.version}`);
  console.log(`relay ${relay.url}\n`);
  try {
    const pairings: number[] = [];
    for (let i = 0; i < 20; i++) {
      const s = await session(relay.url);
      pairings.push(s.pairing);
      s.close();
    }
    console.log(`pair and approve (Room.create → walletpair_connect result):\n  ${summary(pairings)}`);

    const { client, account, close } = await session(relay.url);
    for (let i = 0; i < 100; i++) await client.call('wallet_getCapabilities', [account]);

    const reads: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const started = performance.now();
      await client.call('wallet_getCapabilities', [account]);
      reads.push(performance.now() - started);
    }
    console.log(`\nwallet_getCapabilities, sequential (protocol round trip, no signing):\n  ${summary(reads)}`);

    const signs: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const started = performance.now();
      await client.call('personal_sign', [`0x${i.toString(16).padStart(4, '0')}`, account]);
      signs.push(performance.now() - started);
    }
    console.log(`\npersonal_sign, sequential (round trip + secp256k1 signing in viem):\n  ${summary(signs)}`);

    const total = 5000;
    const inFlight = 50;
    let next = 0;
    const started = performance.now();
    await Promise.all(
      Array.from({ length: inFlight }, async () => {
        while (next < total) {
          const i = next++;
          await client.call('wallet_getCapabilities', [account]);
          void i;
        }
      }),
    );
    const seconds = (performance.now() - started) / 1000;
    console.log(`\nthroughput, ${inFlight} calls in flight, ${total} wallet_getCapabilities:\n  ${(total / seconds).toFixed(0)} calls/s`);
    close();
  } finally {
    relay.stop();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
