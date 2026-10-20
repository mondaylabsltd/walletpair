// A phone running the reference Wallet over PeerConnect: joins from a
// walletpair: URI, keeps its room record and Wallet store, and can restart.

import { connect, Room, type Connection } from '../../vendor/peerconnect/index.js';
import { evmSigner } from '../../src/wallet/evm';
import { solanaSigner } from '../../src/wallet/solana';
import { tronSigner } from '../../src/wallet/tron';
import { ReferenceWallet, emptyStore, type Prompts, type WalletStore } from '../../src/wallet/wallet';

export class WalletDevice {
  record: string;
  store: WalletStore = emptyStore();
  conn!: Connection;
  wallet!: ReferenceWallet;
  readonly evm = evmSigner();
  readonly tron = tronSigner();
  readonly solana = solanaSigner();

  constructor(
    uri: string,
    readonly prompts: Prompts,
  ) {
    if (!uri.startsWith('walletpair:')) throw new Error('Not a WalletPair URI');
    // Throws unless the rest is a PeerConnect v1 invite (spec/core.md §2.2).
    const room = Room.join(uri.slice('walletpair:'.length));
    // A joiner saves its record before its first handshake (PeerConnect §3.4).
    this.record = room.toString();
    this.start(room);
  }

  /** Starts (again) from the saved record. */
  start(room: Room | string = this.record): void {
    this.conn = connect(room);
    this.conn.addEventListener('paired', () => (this.record = this.conn.room.toString()));
    this.wallet = new ReferenceWallet(this.conn, {
      name: 'Reference Wallet',
      signers: [this.evm, this.tron, this.solana],
      prompts: this.prompts,
      store: this.store,
    });
  }

  /** Stops, as a phone that closes the app; the store survives. */
  stop(): void {
    this.conn.leave();
  }
}
