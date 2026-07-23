import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const MAX_PLAINTEXT_BYTES = 64 * 1024;
const MAX_NESTING_DEPTH = 64;
const EVM_CHAIN = 'eip155:1';

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };
export type SessionPhase =
	| 'idle'
	| 'pairing'
	| 'awaiting_confirmation'
	| 'joining'
	| 'connected'
	| 'closed'
	| 'error';

export interface WebSocketLike {
	readyState: number;
	onopen: ((event: Event) => void) | null;
	onerror: ((event: Event) => void) | null;
	onclose: ((event: CloseEvent) => void) | null;
	onmessage: ((event: MessageEvent<string>) => void) | null;
	send(data: string): void;
	close(): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface ParticipantMeta {
	name: string;
	url: string;
	icon: string;
}

interface RelayIdentity extends ParticipantMeta {
	ch: string;
	pubkey: string;
}

interface ChannelJoined extends RelayIdentity {
	type: 'channel_joined';
}

interface TrafficKeys {
	send: Uint8Array;
	receive: Uint8Array;
	transcriptHash: Uint8Array;
}

export type EvmRequest = {
	id: string;
	method: string;
	params?: JsonValue[] | { [key: string]: JsonValue };
} & { [key: string]: JsonValue };

export type EvmResponse = {
	id: string;
	result?: JsonValue;
	error?: { code: number; message: string; data?: JsonValue } & { [key: string]: JsonValue };
} & { [key: string]: JsonValue };

export type EvmEvent = { event: string; data: JsonValue } & { [key: string]: JsonValue };

export type EvmMessage = EvmRequest | EvmResponse | EvmEvent;

export interface DAppSessionOptions {
	relayUrl: string;
	meta: ParticipantMeta;
	webSocketFactory?: WebSocketFactory;
	onPhase?: (phase: SessionPhase) => void;
	onPeer?: (peer: ParticipantMeta) => void;
	onMessage?: (message: JsonValue, chainId: string) => void;
	onError?: (error: Error) => void;
}

export interface WalletSessionOptions {
	meta: ParticipantMeta;
	webSocketFactory?: WebSocketFactory;
	onPhase?: (phase: SessionPhase) => void;
	onPeer?: (peer: ParticipantMeta) => void;
	onMessage?: (message: JsonValue, chainId: string) => void;
	onError?: (error: Error) => void;
}

function utf8(value: string): Uint8Array {
	return textEncoder.encode(value);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
	const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.length;
	}
	return output;
}

function uint16be(value: number): Uint8Array {
	if (!Number.isInteger(value) || value < 0 || value > 0xffff)
		throw new RangeError('uint16 out of range');
	return Uint8Array.of(value >>> 8, value & 0xff);
}

function uint32be(value: number): Uint8Array {
	if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
		throw new RangeError('uint32 out of range');
	const output = new Uint8Array(4);
	new DataView(output.buffer).setUint32(0, value, false);
	return output;
}

function readUint32be(value: Uint8Array): number {
	if (value.length !== 4) throw new RangeError('uint32 requires four bytes');
	return new DataView(value.buffer, value.byteOffset, 4).getUint32(0, false);
}

function lp(value: string): Uint8Array {
	const bytes = utf8(value);
	if (bytes.length > 0xffff) throw new RangeError('length-prefixed value is too long');
	return concatBytes(uint16be(bytes.length), bytes);
}

function bytesToHex(value: Uint8Array): string {
	return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string, expectedLength?: number): Uint8Array {
	if (!/^(?:[0-9a-f]{2})+$/.test(value))
		throw new TypeError('expected canonical lowercase hexadecimal');
	if (expectedLength !== undefined && value.length !== expectedLength * 2)
		throw new RangeError('unexpected hex length');
	const output = new Uint8Array(value.length / 2);
	for (let index = 0; index < output.length; index += 1)
		output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
	return output;
}

function bytesToBase64Url(value: Uint8Array): string {
	let binary = '';
	for (let offset = 0; offset < value.length; offset += 0x8000) {
		binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string, expectedLength?: number): Uint8Array {
	if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1)
		throw new TypeError('invalid canonical base64url');
	let binary: string;
	try {
		binary = atob(
			value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
		);
	} catch {
		throw new TypeError('invalid base64url');
	}
	const output = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	if (bytesToBase64Url(output) !== value) throw new TypeError('non-canonical base64url');
	if (expectedLength !== undefined && output.length !== expectedLength)
		throw new RangeError('unexpected base64url length');
	return output;
}

function randomBytes(length: number): Uint8Array {
	const output = new Uint8Array(length);
	crypto.getRandomValues(output);
	return output;
}

function isAllZero(value: Uint8Array): boolean {
	return value.every((byte) => byte === 0);
}

function rfc3986Encode(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
	);
}

function utf8Length(value: string): number {
	return utf8(value).length;
}

function requireAbsoluteUrl(value: string, protocols: readonly string[], field: string): void {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new TypeError(`${field} must be an absolute URL`);
	}
	if (!protocols.includes(url.protocol)) throw new TypeError(`${field} has an unsupported scheme`);
}

function validateChannelId(channelId: string): void {
	if (!/^[0-9a-f]{64}$/.test(channelId))
		throw new TypeError('ch must be 64 lowercase hexadecimal characters');
	hexToBytes(channelId, 32);
}

function validatePublicKey(publicKey: string): Uint8Array {
	const decoded = base64UrlToBytes(publicKey, 32);
	if (isAllZero(decoded)) throw new TypeError('pubkey must not be all zero');
	return decoded;
}

function validateParticipantMeta(meta: ParticipantMeta): void {
	const nameLength = utf8Length(meta.name);
	if (nameLength < 1 || nameLength > 128 || /\p{Cc}/u.test(meta.name))
		throw new TypeError('name must be 1–128 UTF-8 bytes with no control characters');
	if (utf8Length(meta.url) > 2048 || utf8Length(meta.icon) > 2048)
		throw new TypeError('metadata URL is too long');
	requireAbsoluteUrl(meta.url, ['http:', 'https:'], 'url');
	requireAbsoluteUrl(meta.icon, ['https:'], 'icon');
}

function validateRelayUrl(relayUrl: string): void {
	requireAbsoluteUrl(relayUrl, ['ws:', 'wss:'], 'relay');
	if (utf8Length(relayUrl) > 2048) throw new TypeError('relay URL is too long');
	const url = new URL(relayUrl);
	if (url.search || url.hash) throw new TypeError('relay URL must not include a query or fragment');
}

function validateIdentity(identity: RelayIdentity): void {
	validateChannelId(identity.ch);
	validateParticipantMeta(identity);
	validatePublicKey(identity.pubkey);
}

function buildRelayConnectionUrl(relayUrl: string, identity: RelayIdentity): string {
	validateRelayUrl(relayUrl);
	validateIdentity(identity);
	return `${relayUrl}?${[
		['ch', identity.ch],
		['name', identity.name],
		['url', identity.url],
		['icon', identity.icon],
		['pubkey', identity.pubkey]
	]
		.map(([key, value]) => `${key}=${rfc3986Encode(value)}`)
		.join('&')}`;
}

function buildPairingUri(relayUrl: string, identity: RelayIdentity): string {
	validateRelayUrl(relayUrl);
	validateIdentity(identity);
	return `walletpair:?${[
		['ch', identity.ch],
		['pubkey', identity.pubkey],
		['relay', relayUrl],
		['name', identity.name],
		['url', identity.url],
		['icon', identity.icon]
	]
		.map(([key, value]) => `${key}=${rfc3986Encode(value)}`)
		.join('&')}`;
}

function parsePairingUri(value: string): { relayUrl: string; identity: RelayIdentity } {
	if (!value.startsWith('walletpair:?') || value.includes('#'))
		throw new TypeError('invalid WalletPair pairing URI');
	const query = value.slice('walletpair:?'.length);
	if (!query) throw new TypeError('pairing URI query is empty');
	const required = new Set(['ch', 'pubkey', 'relay', 'name', 'url', 'icon']);
	const fields = new Map<string, string>();
	for (const part of query.split('&')) {
		const separator = part.indexOf('=');
		if (separator < 1) throw new TypeError('malformed pairing URI field');
		const key = part.slice(0, separator);
		const encoded = part.slice(separator + 1);
		if (!required.has(key) || fields.has(key))
			throw new TypeError('missing, duplicate, or unknown pairing URI field');
		let decoded: string;
		try {
			decoded = decodeURIComponent(encoded);
		} catch {
			throw new TypeError('malformed percent encoding in pairing URI');
		}
		fields.set(key, decoded);
	}
	if (fields.size !== required.size)
		throw new TypeError('pairing URI must have all six required fields');
	const identity: RelayIdentity = {
		ch: fields.get('ch')!,
		pubkey: fields.get('pubkey')!,
		name: fields.get('name')!,
		url: fields.get('url')!,
		icon: fields.get('icon')!
	};
	validateIdentity(identity);
	const relayUrl = fields.get('relay')!;
	validateRelayUrl(relayUrl);
	return { relayUrl, identity };
}

function parseChannelJoined(value: unknown): ChannelJoined | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const expected = ['ch', 'icon', 'name', 'pubkey', 'type', 'url'];
	const keys = Object.keys(record).sort();
	if (
		record.type !== 'channel_joined' ||
		keys.length !== expected.length ||
		keys.some((key, index) => key !== expected[index])
	)
		return null;
	if (
		typeof record.ch !== 'string' ||
		typeof record.name !== 'string' ||
		typeof record.url !== 'string' ||
		typeof record.icon !== 'string' ||
		typeof record.pubkey !== 'string'
	)
		return null;
	const joined: ChannelJoined = {
		type: 'channel_joined',
		ch: record.ch,
		name: record.name,
		url: record.url,
		icon: record.icon,
		pubkey: record.pubkey
	};
	try {
		validateIdentity(joined);
		return joined;
	} catch {
		return null;
	}
}

function pairingCode(identity: RelayIdentity): string {
	const fingerprint = sha256(
		concatBytes(
			utf8('walletpair-v1-dapp-fingerprint'),
			hexToBytes(identity.ch, 32),
			lp(identity.name),
			lp(identity.url),
			lp(identity.icon),
			lp(identity.pubkey)
		)
	);
	const value =
		new DataView(fingerprint.buffer, fingerprint.byteOffset, 4).getUint32(0, false) % 10000;
	return value.toString().padStart(4, '0');
}

function deriveTrafficKeys(
	localPrivateKey: Uint8Array,
	dapp: RelayIdentity,
	walletPublicKey: string,
	role: 'dapp' | 'wallet'
): TrafficKeys {
	const sharedSecret = x25519.getSharedSecret(
		localPrivateKey,
		validatePublicKey(role === 'dapp' ? walletPublicKey : dapp.pubkey)
	);
	if (isAllZero(sharedSecret)) throw new TypeError('X25519 shared secret is all zero');
	try {
		const channelId = hexToBytes(dapp.ch, 32);
		const rootKey = hkdf(sha256, sharedSecret, channelId, utf8('walletpair-v1/root'), 32);
		try {
			const transcriptHash = sha256(
				concatBytes(
					utf8('walletpair-v1/transcript'),
					channelId,
					lp(dapp.pubkey),
					lp(walletPublicKey)
				)
			);
			const dappToWallet = hkdf(
				sha256,
				rootKey,
				transcriptHash,
				utf8('walletpair-v1/dapp-to-wallet'),
				32
			);
			const walletToDapp = hkdf(
				sha256,
				rootKey,
				transcriptHash,
				utf8('walletpair-v1/wallet-to-dapp'),
				32
			);
			return role === 'dapp'
				? { send: dappToWallet, receive: walletToDapp, transcriptHash }
				: { send: walletToDapp, receive: dappToWallet, transcriptHash };
		} finally {
			rootKey.fill(0);
		}
	} finally {
		sharedSecret.fill(0);
	}
}

function messagePackHeader(marker: number, value: number, width: 1 | 2 | 4): Uint8Array {
	const output = new Uint8Array(width + 1);
	output[0] = marker;
	const view = new DataView(output.buffer);
	if (width === 1) view.setUint8(1, value);
	if (width === 2) view.setUint16(1, value, false);
	if (width === 4) view.setUint32(1, value, false);
	return output;
}

function encodeInteger(value: number): Uint8Array {
	if (!Number.isSafeInteger(value)) throw new TypeError('integer is outside the JSON safe range');
	if (value >= 0) {
		if (value <= 0x7f) return Uint8Array.of(value);
		if (value <= 0xff) return messagePackHeader(0xcc, value, 1);
		if (value <= 0xffff) return messagePackHeader(0xcd, value, 2);
		if (value <= 0xffffffff) return messagePackHeader(0xce, value, 4);
		const output = new Uint8Array(9);
		output[0] = 0xcf;
		new DataView(output.buffer).setBigUint64(1, BigInt(value), false);
		return output;
	}
	if (value >= -32) return Uint8Array.of(0x100 + value);
	if (value >= -0x80) {
		const output = Uint8Array.of(0xd0, 0);
		new DataView(output.buffer).setInt8(1, value);
		return output;
	}
	if (value >= -0x8000) {
		const output = new Uint8Array(3);
		output[0] = 0xd1;
		new DataView(output.buffer).setInt16(1, value, false);
		return output;
	}
	if (value >= -0x80000000) {
		const output = new Uint8Array(5);
		output[0] = 0xd2;
		new DataView(output.buffer).setInt32(1, value, false);
		return output;
	}
	const output = new Uint8Array(9);
	output[0] = 0xd3;
	new DataView(output.buffer).setBigInt64(1, BigInt(value), false);
	return output;
}

function encodeString(value: string): Uint8Array {
	const bytes = utf8(value);
	const prefix =
		bytes.length <= 31
			? Uint8Array.of(0xa0 | bytes.length)
			: bytes.length <= 0xff
				? messagePackHeader(0xd9, bytes.length, 1)
				: bytes.length <= 0xffff
					? messagePackHeader(0xda, bytes.length, 2)
					: messagePackHeader(0xdb, bytes.length, 4);
	return concatBytes(prefix, bytes);
}

function encodeMessagePack(value: unknown, depth = 0, ancestors = new Set<object>()): Uint8Array {
	if (depth > MAX_NESTING_DEPTH) throw new RangeError('MessagePack nesting exceeds 64');
	if (value === null) return Uint8Array.of(0xc0);
	if (value === false) return Uint8Array.of(0xc2);
	if (value === true) return Uint8Array.of(0xc3);
	if (typeof value === 'string') return encodeString(value);
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new TypeError('JSON numbers must be finite');
		if (Number.isInteger(value)) return encodeInteger(value);
		const output = new Uint8Array(9);
		output[0] = 0xcb;
		new DataView(output.buffer).setFloat64(1, value, false);
		return output;
	}
	if (typeof value !== 'object' || value === null)
		throw new TypeError('message is outside the JSON data model');
	if (ancestors.has(value)) throw new TypeError('cyclic values are not JSON');
	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			const prefix =
				value.length <= 15
					? Uint8Array.of(0x90 | value.length)
					: value.length <= 0xffff
						? messagePackHeader(0xdc, value.length, 2)
						: messagePackHeader(0xdd, value.length, 4);
			return concatBytes(
				prefix,
				...value.map((item) => encodeMessagePack(item, depth + 1, ancestors))
			);
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null)
			throw new TypeError('only plain JSON objects are supported');
		const entries = Object.entries(value as Record<string, unknown>);
		const prefix =
			entries.length <= 15
				? Uint8Array.of(0x80 | entries.length)
				: entries.length <= 0xffff
					? messagePackHeader(0xde, entries.length, 2)
					: messagePackHeader(0xdf, entries.length, 4);
		return concatBytes(
			prefix,
			...entries.flatMap(([key, entry]) => [
				encodeString(key),
				encodeMessagePack(entry, depth + 1, ancestors)
			])
		);
	} finally {
		ancestors.delete(value);
	}
}

class MessagePackReader {
	private offset = 0;

	constructor(private readonly bytes: Uint8Array) {}

	private take(length: number): Uint8Array {
		if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.length)
			throw new RangeError('truncated MessagePack');
		const output = this.bytes.subarray(this.offset, this.offset + length);
		this.offset += length;
		return output;
	}

	private byte(): number {
		return this.take(1)[0]!;
	}
	private u16(): number {
		const bytes = this.take(2);
		return new DataView(bytes.buffer, bytes.byteOffset, 2).getUint16(0, false);
	}
	private u32(): number {
		const bytes = this.take(4);
		return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
	}
	private string(length: number): string {
		return textDecoder.decode(this.take(length));
	}

	private array(length: number, depth: number): JsonValue[] {
		if (length > this.bytes.length - this.offset)
			throw new RangeError('invalid MessagePack array length');
		return Array.from({ length }, () => this.value(depth + 1));
	}

	private map(length: number, depth: number): { [key: string]: JsonValue } {
		if (length > Math.floor((this.bytes.length - this.offset) / 2))
			throw new RangeError('invalid MessagePack map length');
		const result: { [key: string]: JsonValue } = Object.create(null);
		const keys = new Set<string>();
		for (let index = 0; index < length; index += 1) {
			const key = this.value(depth + 1);
			if (typeof key !== 'string' || keys.has(key))
				throw new TypeError('MessagePack map keys must be unique strings');
			keys.add(key);
			result[key] = this.value(depth + 1);
		}
		return result;
	}

	value(depth: number): JsonValue {
		if (depth > MAX_NESTING_DEPTH) throw new RangeError('MessagePack nesting exceeds 64');
		const marker = this.byte();
		if (marker <= 0x7f) return marker;
		if (marker >= 0xe0) return marker - 0x100;
		if ((marker & 0xe0) === 0xa0) return this.string(marker & 0x1f);
		if ((marker & 0xf0) === 0x90) return this.array(marker & 0x0f, depth);
		if ((marker & 0xf0) === 0x80) return this.map(marker & 0x0f, depth);
		if (marker === 0xc0) return null;
		if (marker === 0xc2) return false;
		if (marker === 0xc3) return true;
		if (marker === 0xcc) {
			const value = this.byte();
			if (value <= 0x7f) throw new TypeError('non-shortest MessagePack integer');
			return value;
		}
		if (marker === 0xcd) {
			const value = this.u16();
			if (value <= 0xff) throw new TypeError('non-shortest MessagePack integer');
			return value;
		}
		if (marker === 0xce) {
			const value = this.u32();
			if (value <= 0xffff) throw new TypeError('non-shortest MessagePack integer');
			return value;
		}
		if (marker === 0xcf) {
			const bytes = this.take(8);
			const value = new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, false);
			if (value <= 0xffffffffn || value > BigInt(Number.MAX_SAFE_INTEGER))
				throw new TypeError('invalid MessagePack uint64');
			return Number(value);
		}
		if (marker === 0xd0) {
			const bytes = this.take(1);
			const value = new DataView(bytes.buffer, bytes.byteOffset, 1).getInt8(0);
			if (value >= -32) throw new TypeError('non-shortest MessagePack integer');
			return value;
		}
		if (marker === 0xd1) {
			const bytes = this.take(2);
			const value = new DataView(bytes.buffer, bytes.byteOffset, 2).getInt16(0, false);
			if (value >= -0x80) throw new TypeError('non-shortest MessagePack integer');
			return value;
		}
		if (marker === 0xd2) {
			const bytes = this.take(4);
			const value = new DataView(bytes.buffer, bytes.byteOffset, 4).getInt32(0, false);
			if (value >= -0x8000) throw new TypeError('non-shortest MessagePack integer');
			return value;
		}
		if (marker === 0xd3) {
			const bytes = this.take(8);
			const value = new DataView(bytes.buffer, bytes.byteOffset, 8).getBigInt64(0, false);
			if (value >= -0x80000000n || value < BigInt(Number.MIN_SAFE_INTEGER))
				throw new TypeError('invalid MessagePack int64');
			return Number(value);
		}
		if (marker === 0xcb) {
			const bytes = this.take(8);
			const value = new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, false);
			if (!Number.isFinite(value) || Number.isInteger(value))
				throw new TypeError('invalid MessagePack float64');
			return value;
		}
		if (marker === 0xd9) return this.string(this.byte());
		if (marker === 0xda) return this.string(this.u16());
		if (marker === 0xdb) return this.string(this.u32());
		if (marker === 0xdc) return this.array(this.u16(), depth);
		if (marker === 0xdd) return this.array(this.u32(), depth);
		if (marker === 0xde) return this.map(this.u16(), depth);
		if (marker === 0xdf) return this.map(this.u32(), depth);
		throw new TypeError(`MessagePack type 0x${marker.toString(16)} is outside the JSON profile`);
	}

	get remaining(): number {
		return this.bytes.length - this.offset;
	}
}

function encodeJsonMessagePack(value: unknown): Uint8Array {
	const encoded = encodeMessagePack(value);
	if (encoded.length > MAX_PLAINTEXT_BYTES)
		throw new RangeError('MessagePack plaintext exceeds 64 KiB');
	return encoded;
}

function decodeJsonMessagePack(bytes: Uint8Array): JsonValue {
	if (bytes.length > MAX_PLAINTEXT_BYTES)
		throw new RangeError('MessagePack plaintext exceeds 64 KiB');
	const reader = new MessagePackReader(bytes);
	const value = reader.value(0);
	if (reader.remaining !== 0) throw new TypeError('trailing MessagePack bytes');
	return value;
}

function validateEvmChain(chainId: string): void {
	if (!/^eip155:(?:0|[1-9][0-9]*)$/.test(chainId))
		throw new TypeError('expected canonical eip155 CAIP-2 chain ID');
	if (utf8Length(chainId) > 41) throw new RangeError('CAIP-2 chain ID is too long');
}

function nonceFor(sequence: Uint8Array): Uint8Array {
	return concatBytes(new Uint8Array(8), sequence);
}

function aadFor(
	channelId: string,
	transcriptHash: Uint8Array,
	direction: 1 | 2,
	sequence: Uint8Array,
	chainId: string
): Uint8Array {
	return concatBytes(
		utf8('walletpair-v1/aead'),
		hexToBytes(channelId, 32),
		transcriptHash,
		Uint8Array.of(direction),
		sequence,
		lp(chainId)
	);
}

abstract class BaseSession {
	protected phase: SessionPhase = 'idle';
	protected socket: WebSocketLike | null = null;
	protected keys: TrafficKeys | null = null;
	protected sendSequence = 0;
	protected receiveSequence = -1;
	protected readonly onPhase: (phase: SessionPhase) => void;
	protected readonly onMessage: (message: JsonValue, chainId: string) => void;
	protected readonly onError: (error: Error) => void;
	private readonly webSocketFactory: WebSocketFactory;

	protected constructor(
		callbacks: Pick<DAppSessionOptions, 'onPhase' | 'onMessage' | 'onError' | 'webSocketFactory'>
	) {
		this.onPhase = callbacks.onPhase ?? (() => {});
		this.onMessage = callbacks.onMessage ?? (() => {});
		this.onError = callbacks.onError ?? (() => {});
		this.webSocketFactory = callbacks.webSocketFactory ?? ((url) => new WebSocket(url));
	}

	protected setPhase(phase: SessionPhase): void {
		this.phase = phase;
		this.onPhase(phase);
	}

	protected async openSocket(
		url: string,
		onJoined: (joined: ChannelJoined) => void
	): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			const socket = this.webSocketFactory(url);
			this.socket = socket;
			socket.onopen = () => resolve();
			socket.onerror = () => reject(new Error('relay WebSocket connection failed'));
			socket.onclose = () => {
				if (this.phase !== 'closed' && this.phase !== 'error') this.setPhase('closed');
			};
			socket.onmessage = (event) => {
				if (typeof event.data !== 'string') return;
				try {
					let parsed: unknown;
					try {
						parsed = JSON.parse(event.data);
					} catch {
						parsed = undefined;
					}
					const joined = parseChannelJoined(parsed);
					if (joined) {
						onJoined(joined);
						return;
					}
					try {
						this.openFrame(event.data);
					} catch {
						// Forged, malformed, or later-joiner frames are ignored without changing receive state.
					}
				} catch (error) {
					this.onError(error instanceof Error ? error : new Error('invalid relay message'));
				}
			};
		});
	}

	protected sendFrame(
		channelId: string,
		direction: 1 | 2,
		value: JsonValue,
		chainId = EVM_CHAIN
	): void {
		if (!this.socket || this.socket.readyState !== 1 || !this.keys)
			throw new Error('encrypted channel is not connected');
		validateEvmChain(chainId);
		if (this.sendSequence > 0x7fffffff)
			throw new Error('send sequence exhausted; pair again with fresh keys');
		const sequence = uint32be(this.sendSequence);
		this.sendSequence += 1;
		const plaintext = encodeJsonMessagePack(value);
		const ciphertext = chacha20poly1305(
			this.keys.send,
			nonceFor(sequence),
			aadFor(channelId, this.keys.transcriptHash, direction, sequence, chainId)
		).encrypt(plaintext);
		this.socket.send(`${bytesToBase64Url(concatBytes(sequence, ciphertext))}@${chainId}`);
	}

	private openFrame(frame: string): void {
		const separator = frame.indexOf('@');
		if (separator < 1 || separator !== frame.lastIndexOf('@'))
			throw new TypeError('invalid encrypted frame separator');
		const sealed = base64UrlToBytes(frame.slice(0, separator));
		const chainId = frame.slice(separator + 1);
		validateEvmChain(chainId);
		if (!this.keys || sealed.length < 20 || sealed.length > 65556)
			throw new TypeError('invalid encrypted frame');
		const sequence = sealed.slice(0, 4);
		const value = readUint32be(sequence);
		if (value <= this.receiveSequence)
			throw new TypeError('replayed or out-of-order encrypted frame');
		const plaintext = chacha20poly1305(
			this.keys.receive,
			nonceFor(sequence),
			aadFor(this.channelId, this.keys.transcriptHash, this.receiveDirection, sequence, chainId)
		).decrypt(sealed.slice(4));
		const message = decodeJsonMessagePack(plaintext);
		this.receiveSequence = value;
		this.onMessage(message, chainId);
	}

	protected destroy(): void {
		this.socket?.close();
		this.socket = null;
		this.keys?.send.fill(0);
		this.keys?.receive.fill(0);
		this.keys?.transcriptHash.fill(0);
		this.keys = null;
		this.setPhase('closed');
	}

	protected abstract get channelId(): string;
	protected abstract get receiveDirection(): 1 | 2;
}

export class DAppSession extends BaseSession {
	readonly pairingUri: string;
	readonly pairingCode: string;
	private readonly relayUrl: string;
	private readonly identity: RelayIdentity;
	private privateKey: Uint8Array;
	private peer: RelayIdentity | null = null;
	private readonly onPeer: (peer: ParticipantMeta) => void;

	constructor(options: DAppSessionOptions) {
		super(options);
		validateRelayUrl(options.relayUrl);
		validateParticipantMeta(options.meta);
		this.relayUrl = options.relayUrl;
		this.privateKey = randomBytes(32);
		this.identity = {
			ch: bytesToHex(randomBytes(32)),
			pubkey: bytesToBase64Url(x25519.getPublicKey(this.privateKey)),
			...options.meta
		};
		this.pairingUri = buildPairingUri(this.relayUrl, this.identity);
		this.pairingCode = pairingCode(this.identity);
		this.onPeer = options.onPeer ?? (() => {});
	}

	get channelId(): string {
		return this.identity.ch;
	}
	get receiveDirection(): 1 | 2 {
		return 2;
	}

	async start(): Promise<void> {
		if (this.phase !== 'idle') throw new Error('pairing session has already started');
		this.setPhase('pairing');
		try {
			await this.openSocket(buildRelayConnectionUrl(this.relayUrl, this.identity), (joined) =>
				this.handleJoined(joined)
			);
		} catch (error) {
			this.setPhase('error');
			throw error;
		}
	}

	private handleJoined(joined: ChannelJoined): void {
		if (joined.ch !== this.identity.ch || joined.pubkey === this.identity.pubkey || this.peer)
			return;
		this.peer = joined;
		this.keys = deriveTrafficKeys(this.privateKey, this.identity, joined.pubkey, 'dapp');
		this.privateKey.fill(0);
		this.setPhase('connected');
		this.onPeer({ name: joined.name, url: joined.url, icon: joined.icon });
	}

	send(message: EvmRequest): void {
		if (!isEvmRequest(message)) throw new TypeError('invalid EVM request envelope');
		this.sendFrame(this.identity.ch, 1, message);
	}

	close(): void {
		this.destroy();
	}
}

export class WalletSession extends BaseSession {
	private identity: RelayIdentity | null = null;
	private dapp: RelayIdentity | null = null;
	private relayUrl = '';
	private privateKey: Uint8Array | null = null;
	private readonly onPeer: (peer: ParticipantMeta) => void;
	private joinTimeout: ReturnType<typeof setTimeout> | null = null;
	private resolveJoin: (() => void) | null = null;
	private rejectJoin: ((error: Error) => void) | null = null;

	constructor(options: WalletSessionOptions) {
		super(options);
		validateParticipantMeta(options.meta);
		this.meta = options.meta;
		this.onPeer = options.onPeer ?? (() => {});
	}

	private readonly meta: ParticipantMeta;
	get channelId(): string {
		if (!this.identity) throw new Error('wallet session has not been prepared');
		return this.identity.ch;
	}
	get receiveDirection(): 1 | 2 {
		return 1;
	}
	get pairingCode(): string {
		if (!this.dapp) throw new Error('wallet session has not been prepared');
		return pairingCode(this.dapp);
	}

	prepare(pairingUri: string): void {
		if (this.phase !== 'idle') throw new Error('wallet session has already been prepared');
		const parsed = parsePairingUri(pairingUri);
		this.dapp = parsed.identity;
		this.relayUrl = parsed.relayUrl;
		this.privateKey = randomBytes(32);
		this.identity = {
			ch: parsed.identity.ch,
			pubkey: bytesToBase64Url(x25519.getPublicKey(this.privateKey)),
			...this.meta
		};
		this.keys = deriveTrafficKeys(this.privateKey, parsed.identity, this.identity.pubkey, 'wallet');
		this.privateKey.fill(0);
		this.privateKey = null;
		this.setPhase('awaiting_confirmation');
		this.onPeer({
			name: parsed.identity.name,
			url: parsed.identity.url,
			icon: parsed.identity.icon
		});
	}

	async confirm(): Promise<void> {
		if (!this.identity || !this.dapp || this.phase !== 'awaiting_confirmation')
			throw new Error('prepare and verify the pairing code first');
		this.setPhase('joining');
		const ownJoin = new Promise<void>((resolve, reject) => {
			this.resolveJoin = resolve;
			this.rejectJoin = reject;
			this.joinTimeout = setTimeout(() => {
				this.rejectJoin?.(new Error('relay did not confirm this wallet join within 8 seconds'));
			}, 8_000);
		});
		try {
			await this.openSocket(buildRelayConnectionUrl(this.relayUrl, this.identity), (joined) =>
				this.handleJoined(joined)
			);
			await ownJoin;
		} catch (error) {
			this.clearJoinWaiter();
			this.setPhase('error');
			throw error;
		}
	}

	private handleJoined(joined: ChannelJoined): void {
		if (
			!this.identity ||
			joined.ch !== this.identity.ch ||
			joined.pubkey !== this.identity.pubkey ||
			this.phase !== 'joining'
		)
			return;
		const resolve = this.resolveJoin;
		this.clearJoinWaiter();
		this.setPhase('connected');
		resolve?.();
	}

	private clearJoinWaiter(): void {
		if (this.joinTimeout) clearTimeout(this.joinTimeout);
		this.joinTimeout = null;
		this.resolveJoin = null;
		this.rejectJoin = null;
	}

	send(message: EvmResponse | EvmEvent): void {
		if (!isEvmResponse(message) && !isEvmEvent(message))
			throw new TypeError('invalid EVM response or event envelope');
		this.sendFrame(this.channelId, 2, message);
	}

	close(): void {
		this.rejectJoin?.(new Error('wallet pairing was closed'));
		this.clearJoinWaiter();
		this.destroy();
	}
}

export function createRequest(
	method: string,
	params?: JsonValue[] | { [key: string]: JsonValue }
): EvmRequest {
	if (typeof method !== 'string' || utf8Length(method) === 0 || utf8Length(method) > 128)
		throw new TypeError('method must be a non-empty string of at most 128 bytes');
	const id = bytesToBase64Url(randomBytes(16));
	return params === undefined ? { id, method } : { id, method, params };
}

export function isEvmRequest(value: JsonValue): value is EvmRequest {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, JsonValue>;
	return (
		isRequestId(record.id) &&
		typeof record.method === 'string' &&
		utf8Length(record.method) > 0 &&
		utf8Length(record.method) <= 128 &&
		!('event' in record) &&
		!('result' in record) &&
		!('error' in record)
	);
}

export function isEvmResponse(value: JsonValue): value is EvmResponse {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, JsonValue>;
	if (
		!isRequestId(record.id) ||
		'result' in record === 'error' in record ||
		'method' in record ||
		'event' in record
	)
		return false;
	if (!('error' in record)) return true;
	if (typeof record.error !== 'object' || record.error === null || Array.isArray(record.error))
		return false;
	const error = record.error as Record<string, JsonValue>;
	return (
		typeof error.code === 'number' &&
		Number.isInteger(error.code) &&
		typeof error.message === 'string'
	);
}

export function isEvmEvent(value: JsonValue): value is EvmEvent {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, JsonValue>;
	return (
		typeof record.event === 'string' &&
		utf8Length(record.event) > 0 &&
		utf8Length(record.event) <= 128 &&
		'data' in record &&
		!('id' in record) &&
		!('method' in record)
	);
}

function isRequestId(value: JsonValue | undefined): value is string {
	return (
		typeof value === 'string' &&
		utf8Length(value) >= 1 &&
		utf8Length(value) <= 128 &&
		/^[\x20-\x7e]+$/.test(value)
	);
}
