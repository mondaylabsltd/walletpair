// Replays spec/test-vectors/evm.json: every input case through the shared
// checks, and every signing case through the reference Wallet's signer, which
// must reproduce what viem produced.

import { describe, expect, it } from 'vitest';
import evmVectors from '../../spec/test-vectors/evm.json';
import { evm, type Network } from '../src/lib/walletpair/networks';
import type { Params } from '../src/lib/walletpair/protocol';
import { evmSigner } from '../src/wallet/evm';
import type { PerformContext, Signer } from '../src/wallet/wallet';

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
});
