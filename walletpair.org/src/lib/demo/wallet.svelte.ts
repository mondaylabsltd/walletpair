// The demo wallet: a WalletPair Wallet in the browser, for trying the
// extension without a phone. It runs the extension's reference Wallet
// (the same code the CLI wallet and the tests use) over PeerConnect.
//
// Test keys only: they are generated here and kept in localStorage.
// Transactions are signed, never broadcast.

import { connect, Room, type Connection } from 'walletpair-extension/peerconnect';
import { describeConnect, describeRequest, type Description } from 'walletpair-extension/wallet/describe';
import { evmSigner } from 'walletpair-extension/wallet/evm';
import { solanaSigner } from 'walletpair-extension/wallet/solana';
import { tronSigner } from 'walletpair-extension/wallet/tron';
import { ReferenceWallet, type Prompts, type Signer, type WalletStore } from 'walletpair-extension/wallet/wallet';
import type { Response } from 'walletpair-extension/walletpair/protocol';

const STORAGE_KEY = 'walletpair-demo-wallet';

/** Chains the demo wallet offers per network. */
export const CHAINS: Record<string, [chain: string, name: string][]> = {
	eip155: [
		['eip155:1', 'Ethereum'],
		['eip155:137', 'Polygon'],
		['eip155:8453', 'Base'],
		['eip155:42161', 'Arbitrum'],
		['eip155:11155111', 'Sepolia']
	],
	tron: [
		['tron:728126428', 'Mainnet'],
		['tron:3448148188', 'Nile'],
		['tron:2494104990', 'Shasta']
	],
	solana: [
		['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'Mainnet'],
		['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', 'Devnet'],
		['solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z', 'Testnet']
	]
};

interface Saved {
	keys: { evm: string; tron: string; solana: string };
	record?: string;
	approved: string[];
	chains: Record<string, string>;
	records: [string, Response | null][];
}

export interface Prompt {
	id: number;
	description: Description;
	answer(approve: boolean): void;
}

export interface Account {
	namespace: string;
	address: string;
	chain: string;
}

function randomKey(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function load(): Saved | undefined {
	try {
		const text = localStorage.getItem(STORAGE_KEY);
		return text ? (JSON.parse(text) as Saved) : undefined;
	} catch {
		return undefined;
	}
}

export class DemoWallet {
	/** Another tab runs the demo wallet; only one may hold the session. */
	elsewhere = $state(false);
	/** A paired session exists. */
	paired = $state(false);
	/** PeerConnect's state: offline, waiting (the extension is away) or connected. */
	connection = $state('');
	dapp = $state<string | undefined>(undefined);
	accounts = $state<Account[]>([]);
	approved = $state<string[]>([]);
	prompts = $state<Prompt[]>([]);
	log = $state<{ time: string; text: string }[]>([]);
	error = $state('');

	#saved: Saved;
	#store: WalletStore;
	#signers: Signer[] = [];
	#conn: Connection | undefined;
	#wallet: ReferenceWallet | undefined;
	#nextPrompt = 1;

	constructor() {
		const saved = load();
		this.#saved = saved ?? {
			keys: { evm: randomKey(), tron: randomKey(), solana: randomKey() },
			approved: [],
			chains: {},
			records: []
		};
		this.#store = {
			approved: [...this.#saved.approved],
			chains: { ...this.#saved.chains },
			records: new Map(this.#saved.records)
		};
		this.#makeSigners();
	}

	/** Starts the wallet in this tab: resumes a saved session, unless another tab has it. */
	async start(): Promise<void> {
		if ('locks' in navigator) {
			const mine = await new Promise<boolean>((resolve) => {
				navigator.locks.request(STORAGE_KEY, { ifAvailable: true }, (lock) => {
					resolve(lock !== null);
					// Held for the life of the page.
					return lock ? new Promise<void>(() => {}) : undefined;
				});
			});
			if (!mine) {
				this.elsewhere = true;
				return;
			}
		}
		this.#save();
		this.#refresh();
		if (this.#saved.record) {
			this.#note('Resuming the saved session');
			this.#open(this.#saved.record);
		}
	}

	/** Pairs with the link the WalletPair extension shows. */
	pair(link: string): void {
		this.error = '';
		const text = link.trim();
		if (!text.startsWith('walletpair:')) {
			this.error = 'A WalletPair link starts with walletpair:';
			return;
		}
		let room: Room;
		try {
			// Throws unless the rest is a PeerConnect invite (spec/core.md §2.2).
			room = Room.join(text.slice('walletpair:'.length));
		} catch {
			this.error = 'This is not a valid WalletPair link.';
			return;
		}
		// A joiner saves its record before its first handshake (PeerConnect §3.4).
		this.#saved.record = room.toString();
		this.#save();
		this.#note('Pairing…');
		this.#open(room);
	}

	setChain(namespace: string, chain: string): void {
		if (this.#wallet) this.#wallet.setChain(namespace, chain);
		else this.#store.chains[namespace] = chain;
		this.#note(`${namespace} switched to ${chain}`);
		this.#save();
		this.#refresh();
	}

	/** Withdraws the approval; the dApp side must ask again. */
	revoke(): void {
		this.#wallet?.revoke();
		this.#note('Approval revoked');
		this.#save();
		this.#refresh();
	}

	/** Ends the session for both sides. */
	end(): void {
		this.#conn?.close();
		this.#note('Ending the session…');
	}

	/** New test keys, when no session is open. */
	newKeys(): void {
		if (this.paired) return;
		this.#saved.keys = { evm: randomKey(), tron: randomKey(), solana: randomKey() };
		this.#makeSigners();
		this.#save();
		this.#refresh();
		this.#note('New test keys');
	}

	#makeSigners(): void {
		const { keys } = this.#saved;
		this.#signers = [
			evmSigner(`0x${keys.evm}`, 'eip155:1'),
			tronSigner(keys.tron, 'tron:728126428'),
			solanaSigner(keys.solana, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
		];
		for (const signer of this.#signers) this.#store.chains[signer.network.namespace] ??= signer.chain;
	}

	#open(room: Room | string): void {
		const conn = connect(room);
		this.#conn = conn;
		this.paired = true;
		conn.addEventListener('state', () => {
			if (this.#conn !== conn) return;
			this.connection = conn.state;
			if (conn.state === 'closed' && conn.reason !== 'left') this.#ended();
		});
		conn.addEventListener('paired', () => {
			this.#saved.record = conn.room.toString();
			this.#save();
			this.#note('Paired with the extension');
		});
		conn.addEventListener('message', () =>
			setTimeout(() => {
				this.#save();
				this.#refresh();
			}, 0)
		);
		this.#wallet = new ReferenceWallet(conn, {
			name: 'WalletPair Demo Wallet',
			signers: this.#signers,
			prompts: this.#prompts(),
			store: this.#store
		});
	}

	#prompts(): Prompts {
		const ask = (description: Description, cancelled?: AbortSignal) =>
			new Promise<boolean>((resolve) => {
				const id = this.#nextPrompt++;
				const remove = () => (this.prompts = this.prompts.filter((p) => p.id !== id));
				this.prompts = [
					...this.prompts,
					{
						id,
						description,
						answer: (approve) => {
							remove();
							this.#note(`${approve ? 'Approved' : 'Rejected'}: ${description.title}`);
							resolve(approve);
						}
					}
				];
				cancelled?.addEventListener('abort', () => {
					remove();
					this.#note(`Cancelled by the dApp: ${description.title}`);
					resolve(false);
				});
			});
		return {
			connect: async (params, offered, origin) => {
				this.dapp = params.name;
				return (await ask(describeConnect(params, offered, origin))) ? offered : [];
			},
			approve: (request, cancelled) => ask(describeRequest(request), cancelled)
		};
	}

	#ended(): void {
		this.#note('The session has ended');
		this.#conn = undefined;
		this.#wallet = undefined;
		this.paired = false;
		this.connection = '';
		this.dapp = undefined;
		for (const prompt of this.prompts) prompt.answer(false);
		this.prompts = [];
		this.#saved.record = undefined;
		this.#store.approved = [];
		this.#store.records.clear();
		this.#save();
		this.#refresh();
	}

	#refresh(): void {
		this.approved = [...this.#store.approved];
		this.accounts = this.#signers.map((signer) => ({
			namespace: signer.network.namespace,
			address: signer.accounts[0],
			chain: this.#store.chains[signer.network.namespace] ?? signer.chain
		}));
	}

	#save(): void {
		this.#saved.approved = [...this.#store.approved];
		this.#saved.chains = { ...this.#store.chains };
		this.#saved.records = [...this.#store.records];
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#saved));
		} catch {
			// Private browsing: the session lasts as long as the page.
		}
	}

	#note(text: string): void {
		this.log = [{ time: new Date().toLocaleTimeString(), text }, ...this.log].slice(0, 30);
	}
}
