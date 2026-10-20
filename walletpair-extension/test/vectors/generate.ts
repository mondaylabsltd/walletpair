// Writes spec/test-vectors/{evm,tron,solana}.json.
//
// - `cases`: which inputs each function accepts. Each gives the namespace
//   state, the params, and the outcome: "ok" or the error code the Wallet
//   answers instead of performing the function.
// - `signing`: what a Wallet returns for given keys, produced with
//   independent implementations (viem, TronWeb, @solana/web3.js, Node's
//   crypto), never with WalletPair's own code, so the vectors check Wallets
//   rather than echo them. secp256k1 (RFC 6979) and Ed25519 signatures are
//   deterministic, so a Wallet must reproduce them exactly.
//
//   npx tsx test/vectors/generate.ts

import { createPrivateKey, sign } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { TronWeb, utils as tronUtils } from 'tronweb';
import { hashMessage, hashTypedData, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'spec', 'test-vectors');
const SECP_KEY = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ED_SEED = '0101010101010101010101010101010101010101010101010101010101010101';
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

type Case = { name: string; method: string; params: unknown; expect: 'ok' | number };

async function write(file: string, content: object): Promise<void> {
  await writeFile(join(dir, file), `${JSON.stringify(content, null, 2)}\n`);
}

async function evm() {
  const account = privateKeyToAccount(`0x${SECP_KEY}`).address.toLowerCase() as `0x${string}`;
  const signer = privateKeyToAccount(`0x${SECP_KEY}`);
  const other = '0x000000000000000000000000000000000000beef';
  const typed = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      Mail: [
        { name: 'to', type: 'address' },
        { name: 'contents', type: 'string' },
      ],
    },
    primaryType: 'Mail' as const,
    domain: { name: 'WalletPair', version: '1', chainId: 1 },
    message: { to: '0x000000000000000000000000000000000000dead', contents: 'Hello' },
  };
  const typedOn = (chainId: unknown) => JSON.stringify({ ...typed, domain: { ...typed.domain, chainId } });
  const tx = { from: account, to: '0x000000000000000000000000000000000000dead', value: '0x1' };
  const calls = { version: '2.0.0', chainId: '0x1', atomicRequired: false, calls: [{ to: '0x000000000000000000000000000000000000dead', value: '0x1' }] };
  const cases: Case[] = [
    { name: 'personal_sign', method: 'personal_sign', params: ['0x68656c6c6f', account], expect: 'ok' },
    { name: 'personal_sign, empty message', method: 'personal_sign', params: ['0x', account], expect: 'ok' },
    { name: 'personal_sign, checksummed address', method: 'personal_sign', params: ['0x68', signer.address], expect: 'ok' },
    { name: 'personal_sign, text instead of hex', method: 'personal_sign', params: ['hello', account], expect: -32602 },
    { name: 'personal_sign, odd hex', method: 'personal_sign', params: ['0x123', account], expect: -32602 },
    { name: 'personal_sign, reversed order', method: 'personal_sign', params: [account, '0x68656c6c6f'], expect: -32602 },
    { name: 'personal_sign, account not approved', method: 'personal_sign', params: ['0x68', other], expect: 4100 },
    { name: 'personal_sign, one param', method: 'personal_sign', params: ['0x68'], expect: -32602 },
    { name: 'eth_signTypedData_v4', method: 'eth_signTypedData_v4', params: [account, typedOn(1)], expect: 'ok' },
    { name: 'eth_signTypedData_v4, chainId as hex', method: 'eth_signTypedData_v4', params: [account, typedOn('0x1')], expect: 'ok' },
    { name: 'eth_signTypedData_v4, chainId as decimal string', method: 'eth_signTypedData_v4', params: [account, typedOn('1')], expect: 'ok' },
    { name: 'eth_signTypedData_v4, another chain', method: 'eth_signTypedData_v4', params: [account, typedOn(137)], expect: 4901 },
    { name: 'eth_signTypedData_v4, object instead of string', method: 'eth_signTypedData_v4', params: [account, typed], expect: -32602 },
    { name: 'eth_signTypedData_v4, not JSON', method: 'eth_signTypedData_v4', params: [account, '{'], expect: -32602 },
    { name: 'eth_signTypedData_v4, no primaryType', method: 'eth_signTypedData_v4', params: [account, JSON.stringify({ ...typed, primaryType: undefined })], expect: -32602 },
    { name: 'eth_sendTransaction', method: 'eth_sendTransaction', params: [tx], expect: 'ok' },
    { name: 'eth_sendTransaction, active chain', method: 'eth_sendTransaction', params: [{ ...tx, chainId: '0x1' }], expect: 'ok' },
    { name: 'eth_sendTransaction, another chain', method: 'eth_sendTransaction', params: [{ ...tx, chainId: '0x89' }], expect: 4901 },
    { name: 'eth_sendTransaction, no from', method: 'eth_sendTransaction', params: [{ to: tx.to }], expect: -32602 },
    { name: 'eth_sendTransaction, from not approved', method: 'eth_sendTransaction', params: [{ ...tx, from: other }], expect: 4100 },
    { name: 'eth_sendTransaction, decimal value', method: 'eth_sendTransaction', params: [{ ...tx, value: 1 }], expect: -32602 },
    { name: 'eth_sendTransaction, leading zero quantity', method: 'eth_sendTransaction', params: [{ ...tx, value: '0x01' }], expect: -32602 },
    { name: 'wallet_switchEthereumChain', method: 'wallet_switchEthereumChain', params: [{ chainId: '0x89' }], expect: 'ok' },
    { name: 'wallet_switchEthereumChain, chain 0', method: 'wallet_switchEthereumChain', params: [{ chainId: '0x0' }], expect: -32602 },
    { name: 'wallet_switchEthereumChain, decimal', method: 'wallet_switchEthereumChain', params: [{ chainId: 137 }], expect: -32602 },
    {
      name: 'wallet_addEthereumChain',
      method: 'wallet_addEthereumChain',
      params: [{ chainId: '0x2105', chainName: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.base.org'] }],
      expect: 'ok',
    },
    {
      name: 'wallet_addEthereumChain, no RPC URL',
      method: 'wallet_addEthereumChain',
      params: [{ chainId: '0x2105', chainName: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [] }],
      expect: -32602,
    },
    { name: 'wallet_sendCalls', method: 'wallet_sendCalls', params: [calls], expect: 'ok' },
    { name: 'wallet_sendCalls, another chain is allowed (EIP-5792)', method: 'wallet_sendCalls', params: [{ ...calls, chainId: '0x89' }], expect: 'ok' },
    { name: 'wallet_sendCalls, no calls', method: 'wallet_sendCalls', params: [{ ...calls, calls: [] }], expect: -32602 },
    { name: 'wallet_sendCalls, no atomicRequired', method: 'wallet_sendCalls', params: [{ ...calls, atomicRequired: undefined }], expect: -32602 },
    { name: 'wallet_sendCalls, from not approved', method: 'wallet_sendCalls', params: [{ ...calls, from: other }], expect: 4100 },
    { name: 'wallet_getCallsStatus', method: 'wallet_getCallsStatus', params: ['0x1234'], expect: 'ok' },
    { name: 'wallet_getCallsStatus, number', method: 'wallet_getCallsStatus', params: [1], expect: -32602 },
    { name: 'wallet_getCapabilities', method: 'wallet_getCapabilities', params: [account, ['0x1']], expect: 'ok' },
    { name: 'wallet_getCapabilities, account not approved', method: 'wallet_getCapabilities', params: [other], expect: 4100 },
  ];
  const { EIP712Domain: _, ...types } = typed.types;
  const message = '0x48656c6c6f2c20576f726c6421';
  return {
    description: 'spec/networks/evm.md. Generated by walletpair-extension/test/vectors/generate.ts.',
    state: { chain: 'eip155:1', accounts: [account] },
    cases,
    signing: {
      source: 'viem',
      privateKey: SECP_KEY,
      personal_sign: {
        params: [message, account],
        digest: hashMessage({ raw: message }),
        result: await signer.signMessage({ message: { raw: message } }),
      },
      eth_signTypedData_v4: {
        params: [account, JSON.stringify(typed)],
        digest: hashTypedData({ domain: typed.domain, types, primaryType: 'Mail', message: typed.message }),
        result: await signer.signTypedData({ domain: typed.domain, types, primaryType: 'Mail', message: typed.message }),
      },
    },
  };
}

async function tron() {
  const tronWeb = new TronWeb({ fullHost: 'http://127.0.0.1:9', privateKey: SECP_KEY });
  const account = TronWeb.address.fromPrivateKey(SECP_KEY) as string;
  const otherAccount = 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7';
  const text = 'Hello TRON ✓';
  const messageHex = toHex(new TextEncoder().encode(text)).slice(2);
  const raw_data = {
    contract: [
      {
        parameter: {
          value: { amount: 1000, owner_address: TronWeb.address.toHex(account), to_address: TronWeb.address.toHex(otherAccount) },
          type_url: 'type.googleapis.com/protocol.TransferContract',
        },
        type: 'TransferContract',
      },
    ],
    ref_block_bytes: '0a1b',
    ref_block_hash: '0102030405060708',
    expiration: 4102444800000,
    timestamp: 4102444740000,
  };
  const pb = tronUtils.transaction.txJsonToPb({ raw_data, visible: false });
  const transaction = {
    visible: false,
    txID: tronUtils.transaction.txPbToTxID(pb).replace(/^0x/, ''),
    raw_data,
    raw_data_hex: tronUtils.transaction.txPbToRawDataHex(pb).toLowerCase(),
  };
  const signed = (await tronWeb.trx.sign(transaction as never, SECP_KEY)) as { signature: string[] };
  const raw = transaction.raw_data_hex;
  const cases: Case[] = [
    { name: 'tron_signMessage', method: 'tron_signMessage', params: { account, message: messageHex }, expect: 'ok' },
    { name: 'tron_signMessage, 0x prefix', method: 'tron_signMessage', params: { account, message: `0x${messageHex}` }, expect: -32602 },
    { name: 'tron_signMessage, empty', method: 'tron_signMessage', params: { account, message: '' }, expect: -32602 },
    { name: 'tron_signMessage, text', method: 'tron_signMessage', params: { account, message: 'hello' }, expect: -32602 },
    { name: 'tron_signMessage, account not approved', method: 'tron_signMessage', params: { account: otherAccount, message: '68' }, expect: 4100 },
    { name: 'tron_signMessage, bad checksum', method: 'tron_signMessage', params: { account: `${account.slice(0, 33)}${account[33] === 'a' ? 'b' : 'a'}`, message: '68' }, expect: -32602 },
    { name: 'tron_signMessage, params as array', method: 'tron_signMessage', params: [account, '68'], expect: -32602 },
    { name: 'tron_signTransaction', method: 'tron_signTransaction', params: { account, transaction: raw }, expect: 'ok' },
    { name: 'tron_signTransaction, active chain', method: 'tron_signTransaction', params: { account, transaction: raw, chain: 'tron:728126428' }, expect: 'ok' },
    { name: 'tron_signTransaction, another chain', method: 'tron_signTransaction', params: { account, transaction: raw, chain: 'tron:3448148188' }, expect: 4901 },
    { name: 'tron_signTransaction, deprecated hex chain', method: 'tron_signTransaction', params: { account, transaction: raw, chain: 'tron:0x2b6653dc' }, expect: -32602 },
    { name: 'tron_signTransaction, JSON instead of raw_data_hex', method: 'tron_signTransaction', params: { account, transaction: transaction as unknown as string }, expect: -32602 },
    { name: 'tron_signTransaction, truncated', method: 'tron_signTransaction', params: { account, transaction: raw.slice(0, 20) }, expect: -32602 },
    { name: 'tron_signTransaction, no contract', method: 'tron_signTransaction', params: { account, transaction: '0a020a1b' }, expect: -32602 },
    { name: 'tron_switchChain', method: 'tron_switchChain', params: { chain: 'tron:3448148188' }, expect: 'ok' },
    { name: 'tron_switchChain, unknown but valid chain', method: 'tron_switchChain', params: { chain: 'tron:1' }, expect: 'ok' },
    { name: 'tron_switchChain, hex', method: 'tron_switchChain', params: { chain: 'tron:0x2b6653dc' }, expect: -32602 },
    { name: 'tron_switchChain, beyond 32 bits', method: 'tron_switchChain', params: { chain: 'tron:4294967296' }, expect: -32602 },
  ];
  return {
    description: 'spec/networks/tron.md. Generated by walletpair-extension/test/vectors/generate.ts. The transaction expires on 2100-01-01.',
    state: { chain: 'tron:728126428', accounts: [account] },
    cases,
    signing: {
      source: 'TronWeb 6',
      privateKey: SECP_KEY,
      tron_signMessage: {
        text,
        params: { account, message: messageHex },
        digest: tronUtils.message.hashMessage(text),
        result: { signature: (await tronWeb.trx.signMessageV2(text, SECP_KEY)).replace(/^0x/, '').toLowerCase() },
      },
      tron_signTransaction: {
        params: { account, transaction: raw },
        txID: transaction.txID,
        // TronWeb writes the last byte in uppercase; the spec has senders write lowercase.
        result: { signature: signed.signature[0].toLowerCase() },
      },
    },
  };
}

function solana() {
  const keypair = Keypair.fromSeed(Buffer.from(ED_SEED, 'hex'));
  const account = keypair.publicKey.toBase58();
  const other = Keypair.fromSeed(Buffer.alloc(32, 2));
  const recentBlockhash = 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k';
  const to = new PublicKey('11111111111111111111111111111112');
  const devnet = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
  const mainnet = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

  const legacy = new Transaction({ feePayer: keypair.publicKey, recentBlockhash }).add(
    SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: to, lamports: 1 }),
  );
  const legacyUnsigned = legacy.serialize({ requireAllSignatures: false, verifySignatures: false });
  legacy.sign(keypair);

  // Two signers: another key pays and has signed; the account signs second.
  const v0 = new VersionedTransaction(
    new TransactionMessage({
      payerKey: other.publicKey,
      recentBlockhash,
      instructions: [SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: to, lamports: 1 })],
    }).compileToV0Message(),
  );
  v0.sign([other]);
  const v0Input = v0.serialize();
  v0.sign([keypair]);

  const notMine = new Transaction({ feePayer: other.publicKey, recentBlockhash })
    .add(SystemProgram.transfer({ fromPubkey: other.publicKey, toPubkey: to, lamports: 1 }))
    .serialize({ requireAllSignatures: false, verifySignatures: false });

  const text = new TextEncoder().encode('Sign in to app.example');
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(ED_SEED, 'hex')]);
  const textSignature = sign(null, Buffer.from(text), createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' }));

  const tx = b64(legacyUnsigned);
  const cases: Case[] = [
    { name: 'solana_signTransactions', method: 'solana_signTransactions', params: { account, transactions: [tx] }, expect: 'ok' },
    { name: 'solana_signTransactions, active chain', method: 'solana_signTransactions', params: { account, transactions: [tx], chain: devnet }, expect: 'ok' },
    { name: 'solana_signTransactions, another chain', method: 'solana_signTransactions', params: { account, transactions: [tx], chain: mainnet }, expect: 4901 },
    { name: 'solana_signTransactions, Wallet Standard chain id', method: 'solana_signTransactions', params: { account, transactions: [tx], chain: 'solana:devnet' }, expect: -32602 },
    { name: 'solana_signTransactions, not a signer', method: 'solana_signTransactions', params: { account, transactions: [b64(notMine)] }, expect: -32602 },
    { name: 'solana_signTransactions, no transactions', method: 'solana_signTransactions', params: { account, transactions: [] }, expect: -32602 },
    { name: 'solana_signTransactions, 17 transactions', method: 'solana_signTransactions', params: { account, transactions: Array(17).fill(tx) }, expect: -32602 },
    { name: 'solana_signTransactions, base64url alphabet', method: 'solana_signTransactions', params: { account, transactions: [`-_${tx.slice(2)}`] }, expect: -32602 },
    { name: 'solana_signTransactions, unpadded', method: 'solana_signTransactions', params: { account, transactions: [tx.replace(/=+$/, '')] }, expect: tx.endsWith('=') ? -32602 : 'ok' },
    { name: 'solana_signTransactions, version 1', method: 'solana_signTransactions', params: { account, transactions: [b64(Uint8Array.of(0x81, ...Buffer.from(legacyUnsigned).subarray(65)))] }, expect: -32602 },
    { name: 'solana_signTransactions, account not approved', method: 'solana_signTransactions', params: { account: other.publicKey.toBase58(), transactions: [b64(notMine)] }, expect: 4100 },
    { name: 'solana_signAndSendTransaction', method: 'solana_signAndSendTransaction', params: { account, transaction: tx, chain: devnet, options: { commitment: 'confirmed', skipPreflight: false, maxRetries: 3 } }, expect: 'ok' },
    { name: 'solana_signAndSendTransaction, no chain', method: 'solana_signAndSendTransaction', params: { account, transaction: tx }, expect: -32602 },
    { name: 'solana_signAndSendTransaction, unknown commitment', method: 'solana_signAndSendTransaction', params: { account, transaction: tx, chain: devnet, options: { commitment: 'recent' } }, expect: -32602 },
    { name: 'solana_signMessage', method: 'solana_signMessage', params: { account, message: b64(text) }, expect: 'ok' },
    { name: 'solana_signMessage, a transaction', method: 'solana_signMessage', params: { account, message: tx }, expect: -32602 },
    { name: 'solana_signMessage, a transaction message', method: 'solana_signMessage', params: { account, message: b64(legacyUnsigned.subarray(65)) }, expect: -32602 },
    { name: 'solana_signMessage, not UTF-8', method: 'solana_signMessage', params: { account, message: b64(Uint8Array.of(0xff, 0xfe, 0xfd)) }, expect: -32602 },
    { name: 'solana_signMessage, empty', method: 'solana_signMessage', params: { account, message: '' }, expect: -32602 },
    { name: 'solana_signMessage, a stray chain member is ignored', method: 'solana_signMessage', params: { account, message: b64(text), chain: mainnet }, expect: 'ok' },
  ];
  return {
    description: 'spec/networks/solana.md. Generated by walletpair-extension/test/vectors/generate.ts.',
    state: { chain: devnet, accounts: [account] },
    cases,
    signing: {
      source: '@solana/web3.js 1.x and Node crypto (Ed25519)',
      seed: ED_SEED,
      solana_signTransactions: [
        { name: 'legacy, one signer', params: { account, transactions: [tx] }, result: { transactions: [b64(legacy.serialize())] } },
        { name: 'v0, second of two signers', params: { account, transactions: [b64(v0Input)] }, result: { transactions: [b64(v0.serialize())] } },
      ],
      solana_signMessage: { params: { account, message: b64(text) }, result: { signature: b64(textSignature) } },
    },
  };
}

await write('evm.json', await evm());
await write('tron.json', await tron());
await write('solana.json', solana());
console.log('spec/test-vectors: evm.json, tron.json, solana.json written');
