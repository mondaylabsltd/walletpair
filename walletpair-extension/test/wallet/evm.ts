// The reference Wallet's EVM signer, built on viem (spec/networks/evm.md §2).

import { keccak256, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chainIdOf, chainOf, evm } from '../../src/lib/walletpair/networks/evm';
import type { Json } from '../../src/lib/walletpair/protocol';
import { WalletError, type Signer } from './wallet';

export const EVM_TEST_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

export function evmSigner(privateKey: Hex = EVM_TEST_KEY, chain = 'eip155:1'): Signer & { sent: Hex[] } {
  const account = privateKeyToAccount(privateKey);
  const known = new Set(['eip155:1', 'eip155:137', 'eip155:11155111']);
  const bundles = new Map<string, { chainId: string }>();
  const sent: Hex[] = [];

  return {
    network: evm,
    chain,
    accounts: [account.address.toLowerCase()],
    sent,
    async perform(method, params, context) {
      const p = params as any;
      switch (method) {
        case 'personal_sign':
          return account.signMessage({ message: { raw: p[0] } });
        case 'eth_signTypedData_v4': {
          const typed = JSON.parse(p[1]);
          const { EIP712Domain: _, ...types } = typed.types;
          return account.signTypedData({ domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message });
        }
        case 'eth_sendTransaction': {
          const tx = p[0];
          const chainId = Number(BigInt(chainIdOf(context.state.chain)));
          const signed = await account.signTransaction({
            type: 'eip1559',
            chainId,
            to: tx.to,
            value: tx.value ? BigInt(tx.value) : 0n,
            data: tx.data ?? tx.input,
            gas: tx.gas ? BigInt(tx.gas) : 21_000n,
            nonce: tx.nonce ? Number(BigInt(tx.nonce)) : 0,
            maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : 1_000_000_000n,
            maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas) : 1_000_000n,
          });
          // The hash is known before broadcasting: what a Wallet records first (core §6).
          sent.push(signed);
          return keccak256(signed);
        }
        case 'wallet_switchEthereumChain': {
          const target = chainOf(p[0].chainId);
          if (!known.has(target)) throw new WalletError(4902, 'Unrecognized chain');
          context.setChain(target);
          return null;
        }
        case 'wallet_addEthereumChain':
          known.add(chainOf(p[0].chainId));
          return null;
        case 'wallet_sendCalls': {
          const id = `0x${crypto.randomUUID().replace(/-/g, '')}`;
          bundles.set(id, { chainId: p[0].chainId });
          return { id };
        }
        case 'wallet_getCallsStatus': {
          const bundle = bundles.get(p[0]);
          if (!bundle) throw new WalletError(5730, 'Unknown bundle id');
          return { version: '2.0.0', id: p[0], chainId: bundle.chainId, status: 100, atomic: true } as Json;
        }
        case 'wallet_getCapabilities':
          return {};
      }
      throw new WalletError(4200, `Unsupported: ${method}`);
    },
  };
}
