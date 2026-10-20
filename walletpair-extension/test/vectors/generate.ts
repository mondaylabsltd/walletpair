// Writes spec/test-vectors/evm.json.
//
// - `cases`: which inputs each function accepts. Each gives the namespace
//   state, the params, and the outcome: "ok" or the error code the Wallet
//   answers instead of performing the function.
// - `signing`: what a Wallet returns for given keys, produced with
//   an independent implementation (viem), never with WalletPair's own code,
//   so the vectors check Wallets rather than echo them. secp256k1 signatures
//   (RFC 6979) are deterministic, so a Wallet must reproduce them exactly.
//
//   npx tsx test/vectors/generate.ts

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashMessage, hashTypedData, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'spec', 'test-vectors');
const SECP_KEY = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

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

await write('evm.json', await evm());
console.log('spec/test-vectors: evm.json written');
