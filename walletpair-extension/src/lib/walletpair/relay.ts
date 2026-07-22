import {
  base64UrlToBytes,
  hexToBytes,
  isAllZero,
  rfc3986Encode,
  utf8Length,
} from './encoding';

export interface ParticipantMeta {
  name: string;
  url: string;
  icon: string;
}

export interface RelayIdentity extends ParticipantMeta {
  ch: string;
  pubkey: string;
}

export interface ChannelJoined extends RelayIdentity {
  type: 'channel_joined';
}

function requireAbsoluteUrl(value: string, protocols: readonly string[], field: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${field} must be an absolute URL`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new TypeError(`${field} uses an unsupported protocol`);
  }
  return parsed;
}

export function validateChannelId(channelId: string): void {
  if (!/^[0-9a-f]{64}$/.test(channelId)) throw new TypeError('ch must be 64 lowercase hex characters');
  hexToBytes(channelId, 32);
}

export function validatePublicKey(publicKey: string): Uint8Array {
  const decoded = base64UrlToBytes(publicKey, 32);
  if (isAllZero(decoded)) throw new TypeError('pubkey must not be all zero');
  return decoded;
}

export function validateParticipantMeta(meta: ParticipantMeta): void {
  const nameLength = utf8Length(meta.name);
  if (nameLength < 1 || nameLength > 128 || /\p{Cc}/u.test(meta.name)) {
    throw new TypeError('name must be 1-128 UTF-8 bytes without control characters');
  }
  if (utf8Length(meta.url) > 2048) throw new TypeError('url is too long');
  if (utf8Length(meta.icon) > 2048) throw new TypeError('icon is too long');
  requireAbsoluteUrl(meta.url, ['http:', 'https:'], 'url');
  requireAbsoluteUrl(meta.icon, ['https:'], 'icon');
}

export function validateRelayIdentity(identity: RelayIdentity): void {
  validateChannelId(identity.ch);
  validateParticipantMeta(identity);
  validatePublicKey(identity.pubkey);
}

export function validateRelayUrl(relayUrl: string): void {
  requireAbsoluteUrl(relayUrl, ['ws:', 'wss:'], 'relay');
  if (utf8Length(relayUrl) > 2048) throw new TypeError('relay is too long');
}

export function buildRelayConnectionUrl(relayUrl: string, identity: RelayIdentity): string {
  validateRelayUrl(relayUrl);
  validateRelayIdentity(identity);
  const url = new URL(relayUrl);
  url.hash = '';
  url.searchParams.set('ch', identity.ch);
  url.searchParams.set('name', identity.name);
  url.searchParams.set('url', identity.url);
  url.searchParams.set('icon', identity.icon);
  url.searchParams.set('pubkey', identity.pubkey);
  return url.toString();
}

export function buildPairingUri(relayUrl: string, identity: RelayIdentity): string {
  validateRelayUrl(relayUrl);
  validateRelayIdentity(identity);
  return 'walletpair:?' + [
    ['ch', identity.ch],
    ['pubkey', identity.pubkey],
    ['relay', relayUrl],
    ['name', identity.name],
    ['url', identity.url],
    ['icon', identity.icon],
  ].map(([key, value]) => `${key}=${rfc3986Encode(value!)}`).join('&');
}

export function parseChannelJoined(value: unknown): ChannelJoined | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.type !== 'channel_joined') return null;
  const keys = Object.keys(record).sort();
  const expected = ['ch', 'icon', 'name', 'pubkey', 'type', 'url'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null;
  if (
    typeof record.ch !== 'string' ||
    typeof record.name !== 'string' ||
    typeof record.url !== 'string' ||
    typeof record.icon !== 'string' ||
    typeof record.pubkey !== 'string'
  ) return null;
  const joined: ChannelJoined = {
    type: 'channel_joined',
    ch: record.ch,
    name: record.name,
    url: record.url,
    icon: record.icon,
    pubkey: record.pubkey,
  };
  try {
    validateRelayIdentity(joined);
    return joined;
  } catch {
    return null;
  }
}
