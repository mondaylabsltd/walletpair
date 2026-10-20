// A DApp-side client and the reference Wallet over PeerConnect-like delivery
// (in memory): every core rule of spec/core.md and every function of the three
// network specifications, with signatures checked by independent libraries.

import { Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { TronWeb, utils as tronUtils } from 'tronweb';
import { parseTransaction as parseEvmTransaction, recoverTransactionAddress, verifyMessage, verifyTypedData } from 'viem';
import { describe, expect, it } from 'vitest';
import { CallError, WalletPairClient } from '../src/lib/walletpair/client';
import { base64Decode, base64Encode, bytesToHex } from '../src/lib/walletpair/codec';
import { namespaceRules } from '../src/lib/walletpair/networks';
import { memoryPair, settle, type MemoryTransport } from './memory-transport';
import { evmSigner } from './wallet/evm';
import { solanaSigner } from './wallet/solana';
import { tronSigner } from './wallet/tron';
import { ReferenceWallet, emptyStore, type Prompts, type WalletStore } from './wallet/wallet';

const DAPP = { name: 'Test DApp', url: 'https://app.example' };
const ALL = ['eip155', 'tron', 'solana'];

/** Prompts the test answers by hand: each prompt waits in `queue`. */
function manualPrompts() {
  const queue: { kind: string; resolve: (answer: any) => void; payload: unknown }[] = [];
  const prompts: Prompts = {
    connect: (params, offered) => new Promise((resolve) => queue.push({ kind: 'connect', resolve, payload: offered })),
    approve: (request) => new Promise((resolve) => queue.push({ kind: 'approve', resolve, payload: request })),
  };
  return { prompts, queue };
}

const approveAll: Prompts = { connect: async (_, offered) => offered, approve: async () => true };

function setup(options: { prompts?: Prompts; store?: WalletStore; maxWaiting?: number } = {}) {
  const [dappEnd, walletEnd] = memoryPair();
  const evm = evmSigner();
  const tron = tronSigner();
  const solana = solanaSigner();
  const signers = [evm, tron, solana];
  const makeWallet = (end: MemoryTransport, store?: WalletStore) =>
    new ReferenceWallet(end, {
      name: 'Reference Wallet',
      signers,
      prompts: options.prompts ?? approveAll,
      store,
      maxWaiting: options.maxWaiting,
    });
  const wallet = makeWallet(walletEnd, options.store);
  const client = new WalletPairClient(dappEnd, namespaceRules);
  return { client, wallet, dappEnd, walletEnd, evm, tron, solana, makeWallet };
}

async function connected(options?: Parameters<typeof setup>[0]) {
  const s = setup(options);
  await s.client.connect(DAPP, ALL);
  return s;
}

async function rejection(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CallError);
    return (error as CallError).code;
  }
  throw new Error('expected a rejection');
}

describe('session', () => {
  it('connects, and the result is the state for every approved namespace', async () => {
    const { client, evm, tron, solana } = setup();
    const result = await client.connect(DAPP, ALL);
    expect(result.wallet).toEqual({ name: 'Reference Wallet' });
    expect(client.state).toEqual({
      eip155: { chain: 'eip155:1', accounts: evm.accounts },
      tron: { chain: 'tron:3448148188', accounts: tron.accounts },
      solana: { chain: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', accounts: solana.accounts },
    });
    expect(client.approved).toBe(true);
  });

  it('declining answers 4001 and leaves the session unapproved', async () => {
    const { client } = setup({ prompts: { connect: async () => [], approve: async () => true } });
    expect(await rejection(client.connect(DAPP, ALL))).toBe(4001);
    expect(client.approved).toBe(false);
  });

  it('a Wallet that serves none of the namespaces answers 4200', async () => {
    const { client } = setup();
    expect(await rejection(client.connect(DAPP, ['cosmos']))).toBe(4200);
  });

  it('approves only what the user approves, and asks again for more', async () => {
    let granted = ['eip155'];
    const { client } = setup({ prompts: { connect: async () => granted, approve: async () => true } });
    await client.connect(DAPP, ALL);
    expect(Object.keys(client.state)).toEqual(['eip155']);
    granted = ['solana'];
    await client.connect(DAPP, ['solana']);
    expect(Object.keys(client.state).sort()).toEqual(['eip155', 'solana']);
  });

  it('answers a repeated connect at once once approved', async () => {
    const { prompts, queue } = manualPrompts();
    const { client } = setup({ prompts });
    const first = client.connect(DAPP, ['eip155']);
    await settle();
    queue.shift()!.resolve(['eip155']);
    await first;
    await client.connect(DAPP, ['eip155']);
    expect(queue).toHaveLength(0);
  });

  it('shows one connection prompt and answers every waiting connect', async () => {
    const { prompts, queue } = manualPrompts();
    const { client } = setup({ prompts });
    const a = client.connect(DAPP, ['eip155']);
    const b = client.connect(DAPP, ['eip155']);
    await settle();
    expect(queue.filter((q) => q.kind === 'connect')).toHaveLength(1);
    queue.shift()!.resolve(['eip155']);
    await Promise.all([a, b]);
  });

  it('refuses functions before approval with 4100', async () => {
    const { client, evm } = setup();
    expect(await rejection(client.call('personal_sign', ['0x00', evm.accounts[0]]))).toBe(4100);
  });

  it('refuses a namespace that is not approved with 4100', async () => {
    const { client, solana } = setup({ prompts: { connect: async () => ['eip155'], approve: async () => true } });
    await client.connect(DAPP, ALL);
    const message = base64Encode(new TextEncoder().encode('hi'));
    expect(await rejection(client.call('solana_signMessage', { account: solana.accounts[0], message }))).toBe(4100);
  });

  it('refuses an unknown function with 4200 and a user rejection with 4001', async () => {
    const { client, evm } = await connected({ prompts: { connect: async (_, o) => o, approve: async () => false } });
    expect(await rejection(client.call('eth_unknown'))).toBe(4200);
    expect(await rejection(client.call('personal_sign', ['0x00', evm.accounts[0]]))).toBe(4001);
  });

  it('answers -32600 to a malformed request it can still address', async () => {
    const { dappEnd } = await connected();
    const answers: string[] = [];
    dappEnd.addEventListener('message', (e) => answers.push(new TextDecoder().decode((e as MessageEvent).data)));
    dappEnd.send(new TextEncoder().encode('{"id":"x","method":7}'));
    dappEnd.send(new TextEncoder().encode('{"method":"personal_sign"}'));
    await settle();
    expect(answers).toEqual(['{"id":"x","error":{"code":-32600,"message":"Invalid request"}}']);
  });

  it('limits the requests waiting for the user (-32005)', async () => {
    const { prompts, queue } = manualPrompts();
    const s = setup({ prompts, maxWaiting: 1 });
    const connecting = s.client.connect(DAPP, ['eip155']);
    await settle();
    queue.shift()!.resolve(['eip155']);
    await connecting;
    const first = s.client.call('personal_sign', ['0x01', s.evm.accounts[0]]);
    await settle();
    expect(await rejection(s.client.call('personal_sign', ['0x02', s.evm.accounts[0]]))).toBe(-32005);
    queue.shift()!.resolve(true);
    await first;
  });
});

describe('state event', () => {
  it('arrives before the response of a function that changes the state', async () => {
    const { client } = await connected();
    let seenBeforeResult: string | undefined;
    const pending = client.call('wallet_switchEthereumChain', [{ chainId: '0x89' }]).then(() => {
      seenBeforeResult = client.state.eip155.chain;
    });
    await pending;
    expect(seenBeforeResult).toBe('eip155:137');
  });

  it('follows chain changes made in the Wallet', async () => {
    const { client, wallet } = await connected();
    wallet.setChain('tron', 'tron:728126428');
    await settle();
    expect(client.state.tron.chain).toBe('tron:728126428');
  });

  it('revoking empties the state but keeps the session', async () => {
    const { client, wallet, evm } = await connected();
    wallet.revoke();
    await settle();
    expect(client.approved).toBe(false);
    expect(client.ended).toBe(false);
    expect(await rejection(client.call('personal_sign', ['0x00', evm.accounts[0]]))).toBe(4100);
  });

  it('is sent by a Wallet that restarts', async () => {
    const { client, wallet, walletEnd, makeWallet } = await connected();
    wallet.setChain('eip155', 'eip155:137');
    await settle();
    let events = 0;
    client.addEventListener('state', () => events++);
    makeWallet(walletEnd, wallet.store);
    await settle();
    expect(events).toBe(1);
    expect(client.state.eip155.chain).toBe('eip155:137');
  });
});

describe('EVM functions', () => {
  it('personal_sign', async () => {
    const { client, evm } = await connected();
    const signature = (await client.call('personal_sign', ['0x68656c6c6f', evm.accounts[0]])) as `0x${string}`;
    expect(await verifyMessage({ address: evm.accounts[0] as `0x${string}`, message: 'hello', signature })).toBe(true);
  });

  it('eth_signTypedData_v4, and 4901 for another chain in the domain', async () => {
    const { client, evm } = await connected();
    const typed = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'chainId', type: 'uint256' },
        ],
        Mail: [{ name: 'contents', type: 'string' }],
      },
      primaryType: 'Mail',
      domain: { name: 'Test', chainId: 1 },
      message: { contents: 'Hello' },
    };
    const signature = (await client.call('eth_signTypedData_v4', [evm.accounts[0], JSON.stringify(typed)])) as `0x${string}`;
    const { EIP712Domain: _, ...types } = typed.types;
    const valid = await verifyTypedData({ ...typed, types, primaryType: 'Mail', address: evm.accounts[0] as `0x${string}`, signature });
    expect(valid).toBe(true);
    const otherChain = JSON.stringify({ ...typed, domain: { name: 'Test', chainId: 137 } });
    expect(await rejection(client.call('eth_signTypedData_v4', [evm.accounts[0], otherChain]))).toBe(4901);
  });

  it('eth_sendTransaction returns the hash of what it signed, and 4901 for another chain', async () => {
    const { client, evm } = await connected();
    const tx = { from: evm.accounts[0], to: '0x000000000000000000000000000000000000dead', value: '0x1', chainId: '0x1' };
    const hash = await client.call('eth_sendTransaction', [tx]);
    expect(evm.sent).toHaveLength(1);
    const parsed = parseEvmTransaction(evm.sent[0]);
    expect(parsed.chainId).toBe(1);
    expect((await recoverTransactionAddress({ serializedTransaction: evm.sent[0] as any })).toLowerCase()).toBe(evm.accounts[0]);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await rejection(client.call('eth_sendTransaction', [{ ...tx, chainId: '0x89' }]))).toBe(4901);
    expect(await rejection(client.call('eth_sendTransaction', [{ ...tx, from: '0x000000000000000000000000000000000000beef' }]))).toBe(4100);
  });

  it('wallet_switchEthereumChain: 4902 for an unknown chain, then addEthereumChain', async () => {
    const { client } = await connected();
    expect(await rejection(client.call('wallet_switchEthereumChain', [{ chainId: '0x2105' }]))).toBe(4902);
    await client.call('wallet_addEthereumChain', [
      { chainId: '0x2105', chainName: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.base.org'] },
    ]);
    expect(client.state.eip155.chain).toBe('eip155:1');
    await client.call('wallet_switchEthereumChain', [{ chainId: '0x2105' }]);
    expect(client.state.eip155.chain).toBe('eip155:8453');
  });

  it('wallet_sendCalls and wallet_getCallsStatus', async () => {
    const { client, evm } = await connected();
    const sent = (await client.call('wallet_sendCalls', [
      { version: '2.0.0', chainId: '0x1', from: evm.accounts[0], atomicRequired: false, calls: [{ to: '0x000000000000000000000000000000000000dead', value: '0x1' }] },
    ])) as { id: string };
    const status = (await client.call('wallet_getCallsStatus', [sent.id])) as { id: string };
    expect(status.id).toBe(sent.id);
    expect(await rejection(client.call('wallet_getCallsStatus', ['0xunknown']))).toBe(5730);
  });
});

describe('TRON functions', () => {
  const tronWeb = new TronWeb({ fullHost: 'http://127.0.0.1:9' });

  it('tron_signMessage is TronWeb’s signMessageV2', async () => {
    const { client, tron } = await connected();
    const message = 'Hello TRON ✓';
    const hex = bytesToHex(new TextEncoder().encode(message));
    const { signature } = (await client.call('tron_signMessage', { account: tron.accounts[0], message: hex })) as { signature: string };
    expect(await tronWeb.trx.verifyMessageV2(message, `0x${signature}`)).toBe(tron.accounts[0]);
  });

  it('tron_signTransaction signs the txID that TronWeb computes', async () => {
    const { client, tron } = await connected();
    const tx = tronTransfer(tron.accounts[0], Date.now() + 60_000);
    const { signature } = (await client.call('tron_signTransaction', {
      account: tron.accounts[0],
      transaction: tx.raw_data_hex,
      chain: 'tron:3448148188',
    })) as { signature: string };
    expect(TronWeb.address.fromHex(tronUtils.crypto.ecRecover(tx.txID, signature))).toBe(tron.accounts[0]);
  });

  it('refuses expired transactions, other chains and V1-style input', async () => {
    const { client, tron } = await connected();
    const expired = tronTransfer(tron.accounts[0], Date.now() - 1000);
    expect(await rejection(client.call('tron_signTransaction', { account: tron.accounts[0], transaction: expired.raw_data_hex }))).toBe(-32602);
    const fresh = tronTransfer(tron.accounts[0], Date.now() + 60_000);
    expect(
      await rejection(client.call('tron_signTransaction', { account: tron.accounts[0], transaction: fresh.raw_data_hex, chain: 'tron:728126428' })),
    ).toBe(4901);
    expect(await rejection(client.call('tron_signTransaction', { account: tron.accounts[0], transaction: 'zz' }))).toBe(-32602);
  });

  it('tron_switchChain', async () => {
    const { client } = await connected();
    await client.call('tron_switchChain', { chain: 'tron:728126428' });
    expect(client.state.tron.chain).toBe('tron:728126428');
    expect(await rejection(client.call('tron_switchChain', { chain: 'tron:1' }))).toBe(4902);
  });

  /** A TransferContract built and encoded by TronWeb, offline. */
  function tronTransfer(owner: string, expiration: number) {
    const raw_data = {
      contract: [
        {
          parameter: {
            value: { amount: 1000, owner_address: TronWeb.address.toHex(owner), to_address: TronWeb.address.toHex('TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7') },
            type_url: 'type.googleapis.com/protocol.TransferContract',
          },
          type: 'TransferContract',
        },
      ],
      ref_block_bytes: '0a1b',
      ref_block_hash: '0102030405060708',
      expiration,
      timestamp: expiration - 60_000,
    };
    const pb = tronUtils.transaction.txJsonToPb({ raw_data, visible: false });
    return {
      raw_data,
      raw_data_hex: tronUtils.transaction.txPbToRawDataHex(pb).toLowerCase(),
      txID: tronUtils.transaction.txPbToTxID(pb).replace(/^0x/, ''),
    };
  }
});

describe('Solana functions', () => {
  const blockhash = '11111111111111111111111111111111';

  function transfer(from: string, version: 'legacy' | 0): Uint8Array {
    const payer = new PublicKey(from);
    const instructions = [SystemProgram.transfer({ fromPubkey: payer, toPubkey: Keypair.generate().publicKey, lamports: 1 })];
    if (version === 'legacy') {
      const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(...instructions);
      return tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    }
    const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message();
    return new VersionedTransaction(message).serialize();
  }

  it('solana_signTransactions signs legacy and v0 transactions that web3.js verifies', async () => {
    const { client, solana } = await connected();
    const inputs = [transfer(solana.accounts[0], 'legacy'), transfer(solana.accounts[0], 0)];
    const { transactions } = (await client.call('solana_signTransactions', {
      account: solana.accounts[0],
      transactions: inputs.map(base64Encode),
    })) as { transactions: string[] };
    const legacy = Transaction.from(base64Decode(transactions[0])!);
    expect(legacy.verifySignatures()).toBe(true);
    const v0 = VersionedTransaction.deserialize(base64Decode(transactions[1])!);
    const signed = await crypto.subtle.verify(
      'Ed25519',
      await crypto.subtle.importKey('raw', new PublicKey(solana.accounts[0]).toBytes(), 'Ed25519', false, ['verify']),
      v0.signatures[0],
      v0.message.serialize(),
    );
    expect(signed).toBe(true);
  });

  it('solana_signAndSendTransaction returns the first signature, and needs the active chain', async () => {
    const { client, solana } = await connected();
    const transaction = base64Encode(transfer(solana.accounts[0], 0));
    const account = solana.accounts[0];
    const { signature } = (await client.call('solana_signAndSendTransaction', {
      account,
      transaction,
      chain: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    })) as { signature: string };
    expect(base64Decode(signature)).toEqual(VersionedTransaction.deserialize(solana.sent[0]).signatures[0]);
    const mainnet = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
    expect(await rejection(client.call('solana_signAndSendTransaction', { account, transaction, chain: mainnet }))).toBe(4901);
    expect(await rejection(client.call('solana_signAndSendTransaction', { account, transaction }))).toBe(-32602);
  });

  it('refuses a transaction it does not sign', async () => {
    const { client, solana } = await connected();
    const other = base64Encode(transfer(Keypair.generate().publicKey.toBase58(), 'legacy'));
    expect(await rejection(client.call('solana_signTransactions', { account: solana.accounts[0], transactions: [other] }))).toBe(-32602);
  });

  it('solana_signMessage signs text and refuses transactions in disguise', async () => {
    const { client, solana } = await connected();
    const account = solana.accounts[0];
    const text = new TextEncoder().encode('Sign in to app.example');
    const { signature } = (await client.call('solana_signMessage', { account, message: base64Encode(text) })) as { signature: string };
    const key = await crypto.subtle.importKey('raw', new PublicKey(account).toBytes(), 'Ed25519', false, ['verify']);
    expect(await crypto.subtle.verify('Ed25519', key, base64Decode(signature)!, text)).toBe(true);

    const tx = transfer(account, 'legacy');
    const message = tx.subarray(1 + 64);
    for (const disguised of [tx, message]) {
      expect(await rejection(client.call('solana_signMessage', { account, message: base64Encode(disguised) }))).toBe(-32602);
    }
    const binary = base64Encode(Uint8Array.of(0xff, 0xfe));
    expect(await rejection(client.call('solana_signMessage', { account, message: binary }))).toBe(-32602);
  });
});

describe('cancellation (core §5)', () => {
  it('removes the prompt, answers the request locally with 4001', async () => {
    const { prompts, queue } = manualPrompts();
    const s = setup({ prompts });
    const connecting = s.client.connect(DAPP, ['eip155']);
    await settle();
    queue.shift()!.resolve(['eip155']);
    await connecting;

    const { id, result } = s.client.start('personal_sign', ['0x01', s.evm.accounts[0]]);
    await settle();
    expect(s.wallet.waiting).toEqual([id]);
    s.client.cancel([id]);
    expect(await rejection(result)).toBe(4001);
    await settle();
    expect(s.wallet.waiting).toEqual([]);
    expect(s.wallet.store.records.get(id)).toMatchObject({ error: { code: 4001 } });
  });

  it('a Wallet that was offline never prompts for a cancelled request', async () => {
    const { prompts, queue } = manualPrompts();
    const s = setup({ prompts });
    const connecting = s.client.connect(DAPP, ['eip155']);
    await settle();
    queue.shift()!.resolve(['eip155']);
    await connecting;

    s.walletEnd.setState('offline');
    const { id, result } = s.client.start('personal_sign', ['0x01', s.evm.accounts[0]]);
    s.client.cancel([id]);
    await rejection(result);
    s.walletEnd.setState('connected');
    await settle();
    // The request arrives with its cancellation right behind it.
    const approvals = queue.filter((q) => q.kind === 'approve');
    expect(approvals.length).toBeLessThanOrEqual(1);
    expect(s.wallet.waiting).toEqual([]);
  });
});

describe('delivery and restarts (core §6)', () => {
  it('requests sent while the Wallet is offline are answered when it is back', async () => {
    const { client, walletEnd, evm } = await connected();
    walletEnd.setState('offline');
    const answer = client.call('personal_sign', ['0x01', evm.accounts[0]]);
    await settle();
    walletEnd.setState('connected');
    await expect(answer).resolves.toMatch(/^0x/);
  });

  it('a Wallet that restarted answers a repeated request from its record, without acting twice', async () => {
    const { client, dappEnd, walletEnd, evm, makeWallet, wallet } = await connected();
    // The Wallet signs, records, and its response is lost when it restarts.
    walletEnd.drop = true;
    const answer = client.call('eth_sendTransaction', [{ from: evm.accounts[0], to: '0x000000000000000000000000000000000000dead' }]);
    await settle();
    expect(evm.sent).toHaveLength(1);
    walletEnd.drop = false;
    makeWallet(walletEnd, wallet.store);
    // The DApp side sees the break and the reconnection, and asks again.
    dappEnd.setState('offline');
    dappEnd.setState('connected');
    await expect(answer).resolves.toMatch(/^0x[0-9a-f]{64}$/);
    expect(evm.sent).toHaveLength(1);
  });

  it('a repeated request still in progress gets no second answer', async () => {
    const { prompts, queue } = manualPrompts();
    const s = setup({ prompts });
    const connecting = s.client.connect(DAPP, ['eip155']);
    await settle();
    queue.shift()!.resolve(['eip155']);
    await connecting;
    const answer = s.client.call('personal_sign', ['0x01', s.evm.accounts[0]]);
    await settle();
    s.dappEnd.setState('offline');
    s.dappEnd.setState('connected');
    await settle();
    expect(queue.filter((q) => q.kind === 'approve')).toHaveLength(1);
    queue.shift()!.resolve(true);
    await expect(answer).resolves.toMatch(/^0x/);
  });

  it('ending the room answers every pending call with 4900', async () => {
    const { prompts, queue } = manualPrompts();
    const s = setup({ prompts });
    const connecting = s.client.connect(DAPP, ['eip155']);
    await settle();
    queue.shift()!.resolve(['eip155']);
    await connecting;
    const answer = s.client.call('personal_sign', ['0x01', s.evm.accounts[0]]);
    await settle();
    s.dappEnd.close();
    expect(await rejection(answer)).toBe(4900);
    expect(s.client.ended).toBe(true);
    expect(await rejection(s.client.call('personal_sign', ['0x01', s.evm.accounts[0]]))).toBe(4900);
  });

  it('pending ids exclude core functions', async () => {
    const { prompts } = manualPrompts();
    const s = setup({ prompts });
    void s.client.connect(DAPP, ['eip155']).catch(() => {});
    expect(s.client.pendingIds).toEqual([]);
  });

  it('a store survives a restart with records and approval', () => {
    const store = emptyStore();
    store.approved.push('eip155');
    const { client } = setup({ store });
    return settle().then(() => expect(client.approved).toBe(true));
  });
});
