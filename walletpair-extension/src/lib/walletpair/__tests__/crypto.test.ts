import { describe, expect, it } from 'vitest';
import {
  computeDappPairingCode,
  createChannelCipher,
  generateX25519KeyPair,
} from '../crypto';
import { base64UrlToBytes } from '../encoding';

const channelId = 'ab'.repeat(32);
const dappMeta = {
  name: 'Example DApp',
  url: 'https://dapp.example',
  icon: 'https://dapp.example/icon.png',
};

describe('WalletPair channel encryption', () => {
  it('derives interoperable, direction-separated keys and protects the CAIP-2 suffix', async () => {
    const dapp = generateX25519KeyPair();
    const wallet = generateX25519KeyPair();
    const dappCipher = createChannelCipher(channelId, 'dapp', dapp.secretKey, dapp.publicKeyBase64Url, wallet.publicKeyBase64Url);
    const walletCipher = createChannelCipher(channelId, 'wallet', wallet.secretKey, dapp.publicKeyBase64Url, wallet.publicKeyBase64Url);
    const persist = async () => {};

    const frame = await dappCipher.seal({ id: 'req-1', method: 'eth_chainId', params: [] }, 'eip155:1', persist);
    await expect(dappCipher.open(frame, persist)).rejects.toThrow();
    await expect(walletCipher.open(frame.replace('@eip155:1', '@eip155:10'), persist)).rejects.toThrow();
    await expect(walletCipher.open(frame, persist)).resolves.toMatchObject({
      caip2: 'eip155:1',
      sequence: 0,
      value: { id: 'req-1', method: 'eth_chainId', params: [] },
    });
    await expect(walletCipher.open(frame, persist)).rejects.toThrow(/replayed|out-of-order/);

    const response = await walletCipher.seal({ id: 'req-1', result: '0x1' }, 'eip155:1', persist);
    await expect(dappCipher.open(response, persist)).resolves.toMatchObject({ value: { id: 'req-1', result: '0x1' } });
  });

  it('persists a single directional counter across different CAIP-2 suffixes', async () => {
    const dapp = generateX25519KeyPair();
    const wallet = generateX25519KeyPair();
    const cipher = createChannelCipher(channelId, 'dapp', dapp.secretKey, dapp.publicKeyBase64Url, wallet.publicKeyBase64Url);
    const persisted: number[] = [];
    const persist = async (counters: { sendSequence: number }) => { persisted.push(counters.sendSequence); };
    const first = await cipher.seal(null, 'eip155:1', persist);
    const second = await cipher.seal(null, 'eip155:10', persist);
    expect([...base64UrlToBytes(first.split('@')[0]!).subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...base64UrlToBytes(second.split('@')[0]!).subarray(0, 4)]).toEqual([0, 0, 0, 1]);
    expect(persisted).toEqual([1, 2]);
  });

  it('computes a stable four-digit DApp authentication code over all five fields', () => {
    const publicKey = 'B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9_AsrhtHHw';
    expect(computeDappPairingCode(channelId, dappMeta, publicKey)).toBe('5019');
  });
});
