// A WalletPair Wallet in the terminal, for trying the extension by hand:
//
//   pnpm wallet "walletpair:wss://…#…"     pair, then approve or reject each request
//   pnpm wallet --resume                   continue the saved session after a restart
//   pnpm wallet --yes "walletpair:…"       approve everything (scripts)
//
// Options: --state <file> (default .walletpair-wallet.json in this directory).
// While it runs: `chain <chain>` switches a namespace's chain (eip155:137,
// tron:728126428, solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp, …), `revoke`
// withdraws the approval, `leave` goes offline for 5 s, `end` ends the
// session, `quit` exits keeping it.
//
// TEST KEYS ONLY. The keys are generated and stored in the state file in
// plain text. Transactions are signed, never broadcast.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { connect, Room, type Connection } from '../../vendor/peerconnect/index.js';
import { base64Decode, bytesToHex, hexToBytes, isUtf8 } from '../../src/lib/walletpair/codec';
import { tronAccount } from '../../src/lib/walletpair/networks/tron';
import { parseTronRaw } from '../../src/lib/walletpair/networks/tron-transaction';
import { parseTransaction } from '../../src/lib/walletpair/networks/solana-transaction';
import type { Request, Response } from '../../src/lib/walletpair/protocol';
import { evmSigner } from './evm';
import { solanaSigner } from './solana';
import { tronSigner } from './tron';
import { ReferenceWallet, type Prompts, type WalletStore } from './wallet';

interface SavedState {
  record: string;
  keys: { evm: string; tron: string; solana: string };
  approved: string[];
  chains: Record<string, string>;
  records: [string, Response | null][];
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const uri = args.find((a) => a.startsWith('walletpair:'));
const statePath = resolve(option('--state') ?? '.walletpair-wallet.json');
const autoApprove = flag('--yes');

if (!uri && !flag('--resume')) {
  console.error('Usage: pnpm wallet [--yes] [--state <file>] "walletpair:…" | --resume');
  process.exit(2);
}

// ── Terminal ──

const terminal = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const lines: string[] = [];
const lineWaiters: ((line: string) => void)[] = [];
terminal.on('line', (line) => {
  const waiter = lineWaiters.shift();
  if (waiter) waiter(line.trim());
  else lines.push(line.trim());
  pump();
});
/** Questions wait their turn: one prompt on screen at a time. */
let asking: Promise<unknown> = Promise.resolve();
function ask(question: string): Promise<boolean> {
  const answer = asking.then(
    () =>
      new Promise<boolean>((done) => {
        console.log(`${question}\n  approve? [y/N]`);
        lineWaiters.push((line) => done(/^y(es)?$/i.test(line)));
      }),
  );
  asking = answer.catch(() => {});
  return answer;
}

// ── State ──

const saved: SavedState | undefined = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : undefined;
if (flag('--resume') && !saved) {
  console.error(`No saved session in ${statePath}`);
  process.exit(2);
}
const keys = saved?.keys ?? {
  evm: randomBytes(32).toString('hex'),
  tron: randomBytes(32).toString('hex'),
  solana: randomBytes(32).toString('hex'),
};
const store: WalletStore = {
  approved: saved?.approved ?? [],
  chains: saved?.chains ?? {},
  records: new Map(saved?.records ?? []),
};

let conn: Connection | undefined;
let wallet: ReferenceWallet;

let room: Room;
if (uri) {
  room = Room.join(uri.slice('walletpair:'.length)); // throws unless it is a PeerConnect v1 invite
} else {
  room = Room.parse(saved!.record);
}

function save(record = conn?.room.toString() ?? room.toString()): void {
  const state: SavedState = { record, keys, approved: store.approved, chains: store.chains, records: [...store.records] };
  writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
}
// A joiner saves its record before its first handshake (PeerConnect §3.4).
save(room.toString());

const signers = [
  evmSigner(`0x${keys.evm}`, 'eip155:11155111'),
  tronSigner(keys.tron, 'tron:3448148188'),
  solanaSigner(keys.solana, 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'),
];

// ── What the user is asked ──

const text = (bytes: Uint8Array) => (isUtf8(bytes) ? JSON.stringify(new TextDecoder().decode(bytes)) : `0x${bytesToHex(bytes)}`);
const TRON_CONTRACTS: Record<number, string> = { 1: 'TransferContract (TRX)', 2: 'TransferAssetContract (TRC-10)', 31: 'TriggerSmartContract' };

function describe(request: Request): string {
  const p = request.params as any;
  const from = request.origin ? ` from ${request.origin}` : '';
  const head = `→ ${request.method}${from}`;
  try {
    switch (request.method) {
      case 'personal_sign':
        return `${head}\n  account ${p[1]}\n  message ${text(hexToBytes(p[0].slice(2))!)}`;
      case 'eth_signTypedData_v4': {
        const typed = JSON.parse(p[1]);
        return `${head}\n  account ${p[0]}\n  ${typed.primaryType} on ${JSON.stringify(typed.domain)}\n  ${JSON.stringify(typed.message)}`;
      }
      case 'eth_sendTransaction':
        return `${head}\n  ${JSON.stringify(p[0])}\n  (signed, not broadcast)`;
      case 'tron_signMessage':
        return `${head}\n  account ${p.account}\n  message ${text(hexToBytes(p.message)!)}`;
      case 'tron_signTransaction': {
        const tx = parseTronRaw(hexToBytes(p.transaction)!);
        const owner = tx?.contract.owner ? tronAccount(tx.contract.owner) : 'unknown';
        const expires = tx?.expiration ? new Date(Number(tx.expiration)).toISOString() : 'unknown';
        return `${head}\n  ${TRON_CONTRACTS[tx?.contract.type ?? -1] ?? `contract type ${tx?.contract.type}`}, owner ${owner}${owner === p.account ? '' : ' (multi-signature)'}\n  expires ${expires}`;
      }
      case 'solana_signTransactions':
      case 'solana_signAndSendTransaction': {
        const list: string[] = p.transactions ?? [p.transaction];
        const parsed = list.map((t) => parseTransaction(base64Decode(t)!));
        const versions = parsed.map((t) => `${t?.version === 0 ? 'v0' : t?.version} (${t?.numRequiredSignatures} signer(s))`).join(', ');
        return `${head}\n  account ${p.account}${p.chain ? ` on ${p.chain}` : ''}\n  ${list.length} transaction(s): ${versions}`;
      }
      case 'solana_signMessage':
        return `${head}\n  account ${p.account}\n  message ${text(base64Decode(p.message)!)}`;
      default:
        return `${head}\n  ${JSON.stringify(p)}`;
    }
  } catch {
    return `${head}\n  ${JSON.stringify(p)}`;
  }
}

const prompts: Prompts = {
  connect: async (params, offered, origin) => {
    const question = `→ walletpair_connect from "${params.name}"${params.url ? ` (${params.url})` : ''}${origin ? `, for ${origin}` : ''}\n  namespaces: ${offered.join(', ')}`;
    if (autoApprove) {
      console.log(`${question}\n  approved (--yes)`);
      return offered;
    }
    return (await ask(question)) ? offered : [];
  },
  approve: async (request) => {
    const question = describe(request);
    if (autoApprove) {
      console.log(`${question}\n  approved (--yes)`);
      return true;
    }
    return ask(question);
  },
};

// ── Session ──

function start(from: Room | string): void {
  const current = connect(from);
  conn = current;
  current.addEventListener('paired', () => {
    save();
    console.log('paired');
  });
  current.addEventListener('state', () => {
    console.log(`[${current.state}${current.reason ? `: ${current.reason}` : ''}]`);
    if (current.state === 'closed' && current.reason !== 'left') {
      console.log('The session has ended.');
      process.exit(0);
    }
  });
  current.addEventListener('message', () => setTimeout(save, 0));
  wallet = new ReferenceWallet(current, { name: 'WalletPair CLI', signers, prompts, store });
}

console.log('WalletPair CLI wallet (TEST KEYS ONLY)');
for (const signer of signers) console.log(`  ${signer.network.namespace.padEnd(7)} ${signer.accounts[0]}  ${store.chains[signer.network.namespace] ?? signer.chain}`);
console.log(`  state   ${statePath}\nCommands: chain <chain> · revoke · leave · end · quit`);
start(room);

// ── Commands ──

function pump(): void {
  while (lines.length) {
    const [command, value] = lines.shift()!.split(/\s+/);
    if (!command) continue;
    if (command === 'chain' && value) {
      const namespace = value.split(':')[0];
      wallet.setChain(namespace, value);
      save();
      console.log(`${namespace} is now on ${value}`);
    } else if (command === 'revoke') {
      wallet.revoke();
      save();
      console.log('approval revoked');
    } else if (command === 'leave') {
      const record = conn!.room.toString();
      conn!.leave();
      console.log('offline for 5 s');
      setTimeout(() => start(record), 5000);
    } else if (command === 'end') {
      conn!.close();
      console.log('ending the session…');
    } else if (command === 'quit') {
      save();
      process.exit(0);
    } else {
      console.log(`unknown command: ${command}`);
    }
  }
}
