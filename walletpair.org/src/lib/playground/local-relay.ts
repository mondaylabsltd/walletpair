import type { WebSocketFactory, WebSocketLike } from '$lib/walletpair/protocol';

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;
const channels = new Map<string, Set<LocalRelaySocket>>();

class LocalRelaySocket implements WebSocketLike {
	readyState = CONNECTING;
	onopen: ((event: Event) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;
	onmessage: ((event: MessageEvent<string>) => void) | null = null;

	private readonly channelId: string;
	private readonly joinedEvent: string;

	constructor(url: string) {
		const parsed = new URL(url);
		const channelId = parsed.searchParams.get('ch');
		const name = parsed.searchParams.get('name');
		const pageUrl = parsed.searchParams.get('url');
		const icon = parsed.searchParams.get('icon');
		const pubkey = parsed.searchParams.get('pubkey');
		if (!channelId || !name || !pageUrl || !icon || !pubkey)
			throw new TypeError('local relay requires a complete WalletPair identity');
		this.channelId = channelId;
		this.joinedEvent = JSON.stringify({
			type: 'channel_joined',
			ch: channelId,
			name,
			url: pageUrl,
			icon,
			pubkey
		});
		const members = channels.get(channelId) ?? new Set<LocalRelaySocket>();
		members.add(this);
		channels.set(channelId, members);

		queueMicrotask(() => {
			if (this.readyState !== CONNECTING) return;
			this.readyState = OPEN;
			this.onopen?.(new Event('open'));
			for (const member of channels.get(channelId) ?? []) member.receive(this.joinedEvent);
		});
	}

	send(data: string): void {
		if (this.readyState !== OPEN) throw new Error('local relay socket is not open');
		for (const member of channels.get(this.channelId) ?? []) {
			if (member !== this) member.receive(data);
		}
	}

	close(): void {
		if (this.readyState === CLOSED) return;
		this.readyState = CLOSED;
		const members = channels.get(this.channelId);
		members?.delete(this);
		if (members?.size === 0) channels.delete(this.channelId);
		this.onclose?.({} as CloseEvent);
	}

	private receive(data: string): void {
		if (this.readyState === OPEN) this.onmessage?.({ data } as MessageEvent<string>);
	}
}

/**
 * The default Playground transport. It models the relay's join-event and frame
 * routing rules without depending on a public WebSocket service, so the dApp
 * and wallet can be tried together in one browser tab.
 */
export const createLocalRelaySocket: WebSocketFactory = (url) => new LocalRelaySocket(url);
