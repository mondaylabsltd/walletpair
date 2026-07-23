import { afterEach, describe, expect, test, vi } from 'vitest';
import { DAppSession, WalletSession, type JsonValue, type SessionPhase } from './protocol';

type Listener<T> = ((event: T) => void) | null;

class RelayWebSocket {
	static readonly OPEN = 1;
	static readonly CLOSED = 3;
	static channels = new Map<string, Set<RelayWebSocket>>();

	readonly channelId: string;
	readonly joined: string;
	readyState = 0;
	onopen: Listener<Event> = null;
	onclose: Listener<CloseEvent> = null;
	onerror: Listener<Event> = null;
	onmessage: Listener<MessageEvent<string>> = null;

	constructor(url: string) {
		const parsed = new URL(url);
		this.channelId = parsed.searchParams.get('ch')!;
		this.joined = JSON.stringify({
			type: 'channel_joined',
			ch: this.channelId,
			name: parsed.searchParams.get('name'),
			url: parsed.searchParams.get('url'),
			icon: parsed.searchParams.get('icon'),
			pubkey: parsed.searchParams.get('pubkey')
		});
		const members = RelayWebSocket.channels.get(this.channelId) ?? new Set<RelayWebSocket>();
		members.add(this);
		RelayWebSocket.channels.set(this.channelId, members);
		queueMicrotask(() => {
			this.readyState = RelayWebSocket.OPEN;
			this.onopen?.(new Event('open'));
			for (const member of members)
				member.onmessage?.({ data: this.joined } as MessageEvent<string>);
		});
	}

	send(data: string) {
		for (const member of RelayWebSocket.channels.get(this.channelId) ?? []) {
			if (member !== this && member.readyState === RelayWebSocket.OPEN) {
				member.onmessage?.({ data } as MessageEvent<string>);
			}
		}
	}

	close() {
		if (this.readyState === RelayWebSocket.CLOSED) return;
		this.readyState = RelayWebSocket.CLOSED;
		RelayWebSocket.channels.get(this.channelId)?.delete(this);
		this.onclose?.({} as CloseEvent);
	}
}

async function flushMessages() {
	await Promise.resolve();
	await Promise.resolve();
}

afterEach(() => {
	RelayWebSocket.channels.clear();
	vi.unstubAllGlobals();
});

describe('WalletPair protocol session', () => {
	test('pairs, encrypts directional EVM frames, and rejects no metadata shortcuts', async () => {
		vi.stubGlobal('WebSocket', RelayWebSocket);
		const dappPhases: SessionPhase[] = [];
		const walletPhases: SessionPhase[] = [];
		const dappMessages: JsonValue[] = [];
		const walletMessages: JsonValue[] = [];
		const dapp = new DAppSession({
			relayUrl: 'wss://relay.example/v1',
			meta: {
				name: 'Example dApp',
				url: 'https://dapp.example',
				icon: 'https://dapp.example/icon.png'
			},
			onPhase: (phase) => dappPhases.push(phase),
			onMessage: (message) => dappMessages.push(message)
		});

		await dapp.start();
		expect(dapp.pairingUri).toMatch(/^walletpair:\?ch=[0-9a-f]{64}&pubkey=/);
		expect(dapp.pairingCode).toMatch(/^\d{4}$/);

		const wallet = new WalletSession({
			meta: {
				name: 'Example Wallet',
				url: 'https://wallet.example',
				icon: 'https://wallet.example/icon.png'
			},
			onPhase: (phase) => walletPhases.push(phase),
			onMessage: (message) => walletMessages.push(message)
		});
		wallet.prepare(dapp.pairingUri);
		expect(wallet.pairingCode).toBe(dapp.pairingCode);
		await wallet.confirm();
		await flushMessages();
		expect(dappPhases).toContain('connected');
		expect(walletPhases).toContain('connected');

		dapp.send({ id: 'req-1', method: 'eth_chainId', params: [] });
		await flushMessages();
		expect(walletMessages).toEqual([{ id: 'req-1', method: 'eth_chainId', params: [] }]);

		wallet.send({ id: 'req-1', result: '0x1' });
		await flushMessages();
		expect(dappMessages).toEqual([{ id: 'req-1', result: '0x1' }]);
	});
});
