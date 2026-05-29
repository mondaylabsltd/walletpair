export type LogEntry = { dir: 'out' | 'in' | 'err'; type: string; detail: string; time: string };

class PlaygroundState {
	relayUrl = $state('wss://relay.walletpair.org/v1');
	pairingUri = $state('');
	activeTab: 'dapp' | 'wallet' = $state('dapp');
	mode: 'protocol' | 'evm' = $state('protocol');
	transport: 'ws' | 'ble' = $state('ws');
}

export const playground = new PlaygroundState();
