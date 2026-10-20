// The demo dApp: reaches the WalletPair extension the way dApps on each
// network do (EIP-6963, TIP-6963, the Wallet Standard), builds the
// transactions it asks to sign, and checks every signature it gets back.

import { ed25519 } from '@noble/curves/ed25519.js';
import { keccak256, recoverPublicKey, verifyMessage, verifyTypedData, type Hex } from 'viem';
import { base58Decode, base58Encode, bytesToHex, hexToBytes } from 'walletpair-extension/walletpair/codec';
import { tronAccount, tronAddressBytes } from 'walletpair-extension/walletpair/networks/tron';

export const RDNS = 'org.walletpair.extension';

// ── Discovery ──

export interface Eip1193 {
	request(args: { method: string; params?: unknown }): Promise<any>;
	on(event: string, listener: (...args: any[]) => void): unknown;
}

export interface TronProvider extends Eip1193 {
	tronWeb:
		| false
		| {
				trx: {
					sign(tx: unknown): Promise<{ signature: string[] }>;
					signMessageV2(message: string): Promise<string>;
				};
		  };
}

interface StandardAccount {
	address: string;
	publicKey: Uint8Array;
}

export interface StandardWallet {
	name: string;
	accounts: readonly StandardAccount[];
	features: Record<string, any>;
}

/** The provider announced through EIP-6963 or TIP-6963 under WalletPair's rdns, if any. */
export function discover<T>(event: 'eip6963' | 'TIP6963', timeout = 500): Promise<T | undefined> {
	return new Promise((resolve) => {
		const done = (value: T | undefined) => {
			window.removeEventListener(`${event}:announceProvider`, listener);
			clearTimeout(timer);
			resolve(value);
		};
		const listener = (e: Event) => {
			const detail = (e as CustomEvent).detail;
			if (detail?.info?.rdns === RDNS) done(detail.provider as T);
		};
		const timer = setTimeout(() => done(undefined), timeout);
		window.addEventListener(`${event}:announceProvider`, listener);
		window.dispatchEvent(new Event(`${event}:requestProvider`));
	});
}

/** The WalletPair wallet among Wallet Standard wallets, if registered. */
export function discoverSolana(): StandardWallet | undefined {
	const wallets: StandardWallet[] = [];
	const register = (...added: StandardWallet[]) => {
		wallets.push(...added);
		return () => {};
	};
	const onRegister = (e: Event) => (e as CustomEvent).detail?.({ register });
	window.addEventListener('wallet-standard:register-wallet', onRegister);
	window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: { register } }));
	window.removeEventListener('wallet-standard:register-wallet', onRegister);
	return wallets.find((w) => w.name === 'WalletPair');
}

// ── Checks ──

const utf8 = (text: string) => new TextEncoder().encode(text);
const toHex = (bytes: Uint8Array): Hex => `0x${bytesToHex(bytes)}`;

export function verifyEvmMessage(address: string, message: string, signature: Hex): Promise<boolean> {
	return verifyMessage({ address: address as Hex, message, signature });
}

export function verifyEvmTyped(address: string, typed: TypedData, signature: Hex): Promise<boolean> {
	return verifyTypedData({ ...typed, address: address as Hex, signature } as never);
}

/** The TRON account that produced a 65-byte signature over a digest. */
async function tronSigner(digest: Hex, signature: string): Promise<string> {
	const publicKey = hexToBytes((await recoverPublicKey({ hash: digest, signature: `0x${signature.replace(/^0x/, '')}` })).slice(2))!;
	const address = new Uint8Array(21);
	address[0] = 0x41;
	address.set(hexToBytes(keccak256(publicKey.subarray(1)).slice(2))!.subarray(12), 1);
	return tronAccount(address);
}

export function verifyTronMessage(account: string, message: string, signature: string): Promise<boolean> {
	const bytes = utf8(message);
	const prefixed = new Uint8Array([...utf8(`\x19TRON Signed Message:\n${bytes.length}`), ...bytes]);
	return tronSigner(keccak256(prefixed), signature).then((signer) => signer === account);
}

export function verifyTronTransaction(account: string, txID: string, signature: string): Promise<boolean> {
	return tronSigner(`0x${txID}`, signature).then((signer) => signer === account);
}

export function verifyEd25519(address: string, message: Uint8Array, signature: Uint8Array): boolean {
	return ed25519.verify(signature, message, base58Decode(address)!);
}

// ── What the demo asks to sign ──

export interface TypedData {
	types: Record<string, { name: string; type: string }[]>;
	primaryType: string;
	domain: Record<string, unknown>;
	message: Record<string, unknown>;
}

export function typedData(chainId: number): TypedData {
	return {
		types: {
			EIP712Domain: [
				{ name: 'name', type: 'string' },
				{ name: 'version', type: 'string' },
				{ name: 'chainId', type: 'uint256' }
			],
			Greeting: [
				{ name: 'from', type: 'string' },
				{ name: 'contents', type: 'string' }
			]
		},
		primaryType: 'Greeting',
		domain: { name: 'WalletPair Demo', version: '1', chainId },
		message: { from: 'walletpair.org', contents: 'Hello from the demo dApp' }
	};
}

export const messageHex = (text: string): Hex => toHex(utf8(text));

// Protocol buffers, as much as a TRX transfer needs.
function varint(value: bigint): number[] {
	const out: number[] = [];
	do {
		let byte = Number(value & 0x7fn);
		value >>= 7n;
		if (value) byte |= 0x80;
		out.push(byte);
	} while (value);
	return out;
}
const field = (number: number, wire: 0 | 2, payload: number[] | bigint): number[] =>
	wire === 0
		? [...varint(BigInt((number << 3) | 0)), ...varint(payload as bigint)]
		: [...varint(BigInt((number << 3) | 2)), ...varint(BigInt((payload as number[]).length)), ...(payload as number[])];

/** A TRX transfer to oneself, as a TRON node would build it (Transaction.raw), with its txID. */
export async function tronTransfer(account: string): Promise<{ txID: string; raw_data_hex: string; visible: boolean }> {
	const owner = [...tronAddressBytes(account)!];
	const transfer = [...field(1, 2, owner), ...field(2, 2, owner), ...field(3, 0, 1n)];
	const any = [...field(1, 2, [...utf8('type.googleapis.com/protocol.TransferContract')]), ...field(2, 2, transfer)];
	const contract = [...field(1, 0, 1n), ...field(2, 2, any)];
	const now = Date.now();
	const raw = new Uint8Array([
		...field(1, 2, [0x0a, 0x1b]),
		...field(4, 2, [...crypto.getRandomValues(new Uint8Array(8))]),
		...field(8, 0, BigInt(now + 60_000)),
		...field(11, 2, contract),
		...field(14, 0, BigInt(now))
	]);
	const txID = bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)));
	return { txID, raw_data_hex: bytesToHex(raw), visible: false };
}

/** A legacy Solana transfer of 1 lamport from the account, unsigned. */
export function solanaTransfer(address: string): Uint8Array {
	const payer = base58Decode(address)!;
	const to = new Uint8Array(32).fill(7);
	const system = new Uint8Array(32);
	const blockhash = crypto.getRandomValues(new Uint8Array(32));
	const data = new Uint8Array(12);
	new DataView(data.buffer).setUint32(0, 2, true);
	new DataView(data.buffer).setBigUint64(4, 1n, true);
	const message = new Uint8Array([1, 0, 1, 3, ...payer, ...to, ...system, ...blockhash, 1, 2, 2, 0, 1, 12, ...data]);
	return new Uint8Array([1, ...new Uint8Array(64), ...message]);
}

/** The signer's signature and the signed message of a one-signer transaction. */
export function solanaSignature(signed: Uint8Array): { signature: Uint8Array; message: Uint8Array } {
	return { signature: signed.subarray(1, 65), message: signed.subarray(65) };
}

export { base58Encode };
