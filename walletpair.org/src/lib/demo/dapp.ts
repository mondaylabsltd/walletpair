// The demo dApp: reaches the WalletPair extension the way EVM dApps do
// (EIP-6963), and checks every signature it gets back.

import { toHex, verifyMessage, verifyTypedData, type Hex } from 'viem';

export const RDNS = 'org.walletpair.extension';

// ── Discovery ──

export interface Eip1193 {
	request(args: { method: string; params?: unknown }): Promise<any>;
	on(event: string, listener: (...args: any[]) => void): unknown;
}

/** The provider announced through EIP-6963 under WalletPair's rdns, if any. */
export function discover(timeout = 500): Promise<Eip1193 | undefined> {
	return new Promise((resolve) => {
		const done = (value: Eip1193 | undefined) => {
			window.removeEventListener('eip6963:announceProvider', listener);
			clearTimeout(timer);
			resolve(value);
		};
		const listener = (e: Event) => {
			const detail = (e as CustomEvent).detail;
			if (detail?.info?.rdns === RDNS) done(detail.provider as Eip1193);
		};
		const timer = setTimeout(() => done(undefined), timeout);
		window.addEventListener('eip6963:announceProvider', listener);
		window.dispatchEvent(new Event('eip6963:requestProvider'));
	});
}

// ── Checks ──

export function verifyEvmMessage(address: string, message: string, signature: Hex): Promise<boolean> {
	return verifyMessage({ address: address as Hex, message, signature });
}

export function verifyEvmTyped(address: string, typed: TypedData, signature: Hex): Promise<boolean> {
	return verifyTypedData({ ...typed, address: address as Hex, signature } as never);
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

export const messageHex = (text: string): Hex => toHex(text);
