// Replays spec/test-vectors/{evm,tron,solana}.json: every input case through
// the shared checks, and every signing case through the reference Wallet's
// signers, which must reproduce what viem, TronWeb and web3.js produced.

import { describe, expect, it } from 'vitest';
import evmVectors from '../../spec/test-vectors/evm.json';
import solanaVectors from '../../spec/test-vectors/solana.json';
import tronVectors from '../../spec/test-vectors/tron.json';
import { bytesToHex, hexToBytes } from '../src/lib/walletpair/codec';
import { evm, solana, tron, type Network } from '../src/lib/walletpair/networks';
import type { Params } from '../src/lib/walletpair/protocol';
import { evmSigner } from './wallet/evm';
import { solanaSigner } from './wallet/solana';
import { tronMessageDigest, tronSigner } from './wallet/tron';
import type { PerformContext, Signer } from './wallet/wallet';

interface Vectors {
  state: { chain: string; accounts: string[] };
  cases: { name: string; method: string; params: unknown; expect: 'ok' | number }[];
}

function replayCases(network: Network, vectors: Vectors): void {
  describe(`${network.namespace}: which inputs each function accepts`, () => {
    for (const c of vectors.cases) {
      it(c.name, () => {
        const refused = network.functions[c.method].check(c.params as Params, vectors.state);
        expect(refused === null ? 'ok' : refused.code).toBe(c.expect);
      });
    }
  });
}

replayCases(evm, evmVectors as Vectors);
replayCases(tron, tronVectors as Vectors);
replayCases(solana, solanaVectors as Vectors);

function perform(signer: Signer, method: string, params: unknown, state: { chain: string; accounts: string[] }) {
  const context: PerformContext = { request: { id: '1', method }, state, setChain: () => {} };
  return signer.perform(method, params as Params, context);
}

describe('signing vectors', () => {
  it('EVM: personal_sign and eth_signTypedData_v4 (viem)', async () => {
    const { signing, state } = evmVectors;
    const signer = evmSigner(`0x${signing.privateKey}`);
    expect(signer.accounts).toEqual(state.accounts);
    expect(await perform(signer, 'personal_sign', signing.personal_sign.params, state)).toBe(signing.personal_sign.result);
    expect(await perform(signer, 'eth_signTypedData_v4', signing.eth_signTypedData_v4.params, state)).toBe(signing.eth_signTypedData_v4.result);
  });

  it('TRON: the V2 message digest and signature, and the transaction signature (TronWeb)', async () => {
    const { signing, state } = tronVectors;
    // A minute before the vector transaction expires (2100-01-01), so it is neither expired nor too far off.
    const signer = tronSigner(signing.privateKey, state.chain, () => Date.UTC(2100, 0, 1) - 60_000);
    expect(signer.accounts).toEqual(state.accounts);
    const message = signing.tron_signMessage;
    expect(`0x${bytesToHex(tronMessageDigest(hexToBytes(message.params.message)!))}`).toBe(message.digest);
    expect(await perform(signer, 'tron_signMessage', message.params, state)).toEqual(message.result);
    const tx = signing.tron_signTransaction;
    expect(await perform(signer, 'tron_signTransaction', tx.params, state)).toEqual(tx.result);
  });

  it('Solana: legacy, a second signer of v0, and a message (web3.js, Node crypto)', async () => {
    const { signing, state } = solanaVectors;
    const signer = solanaSigner(signing.seed, state.chain);
    expect(signer.accounts).toEqual(state.accounts);
    for (const c of signing.solana_signTransactions) {
      expect(await perform(signer, 'solana_signTransactions', c.params, state), c.name).toEqual(c.result);
    }
    expect(await perform(signer, 'solana_signMessage', signing.solana_signMessage.params, state)).toEqual(signing.solana_signMessage.result);
  });
});
