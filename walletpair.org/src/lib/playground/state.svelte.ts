export type LogEntry = { dir: 'out' | 'in' | 'err'; type: string; detail: string };

class PlaygroundState {
	relayUrl = $state('wss://relay.walletpair.org/v1');
	pairingUri = $state('');
	activeTab: 'dapp' | 'wallet' = $state('dapp');
}

export const playground = new PlaygroundState();
