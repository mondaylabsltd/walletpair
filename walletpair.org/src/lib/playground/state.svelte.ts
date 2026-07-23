export type LogEntry = { dir: 'out' | 'in' | 'err'; type: string; detail: string; time: string };

class PlaygroundState {
	relayUrl = $state('wss://relay.walletpair.org/v1');
	transport = $state<'local' | 'relay'>('local');
	pairingUri = $state('');
	activeTab: 'dapp' | 'wallet' = $state('dapp');
}

export const playground = new PlaygroundState();
