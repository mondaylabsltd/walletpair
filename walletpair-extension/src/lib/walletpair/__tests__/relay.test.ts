import { describe, expect, it } from 'vitest';
import { generateX25519KeyPair } from '../crypto';
import { buildPairingUri, buildRelayConnectionUrl, parseChannelJoined } from '../relay';

const ch = '01'.repeat(32);
const meta = {
  name: 'WalletPair Extension',
  url: 'https://walletpair.org/app?a=1&b=2',
  icon: 'https://walletpair.org/icon.png',
};

describe('relay protocol', () => {
  it('builds a connection URL with all five required fields', () => {
    const pubkey = generateX25519KeyPair().publicKeyBase64Url;
    const value = buildRelayConnectionUrl('wss://relay.walletpair.org/v1', { ch, pubkey, ...meta });
    const url = new URL(value);
    expect(url.protocol).toBe('wss:');
    expect(url.pathname).toBe('/v1');
    expect(Object.fromEntries(url.searchParams)).toEqual({ ch, name: meta.name, url: meta.url, icon: meta.icon, pubkey });
  });

  it('serializes the pairing URI with RFC 3986 encoded decoded values', () => {
    const pubkey = generateX25519KeyPair().publicKeyBase64Url;
    const uri = buildPairingUri('wss://relay.walletpair.org/v1', { ch, pubkey, ...meta });
    expect(uri).toContain('walletpair:?ch=');
    expect(uri).toContain('relay=wss%3A%2F%2Frelay.walletpair.org%2Fv1');
    expect(uri).toContain('url=https%3A%2F%2Fwalletpair.org%2Fapp%3Fa%3D1%26b%3D2');
    expect(uri).not.toContain('+');
  });

  it('validates join events and rejects missing, extra, or invalid fields', () => {
    const pubkey = generateX25519KeyPair().publicKeyBase64Url;
    const joined = { type: 'channel_joined', ch, pubkey, ...meta };
    expect(parseChannelJoined(joined)).toEqual(joined);
    expect(parseChannelJoined({ ...joined, icon: undefined })).toBeNull();
    expect(parseChannelJoined({ ...joined, extra: true })).toBeNull();
    expect(parseChannelJoined({ ...joined, pubkey: 'A'.repeat(43) })).toBeNull();
    expect(parseChannelJoined({ ...joined, name: 'bad\nname' })).toBeNull();
  });
});
