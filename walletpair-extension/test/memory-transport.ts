// Two connected ends with PeerConnect's delivery semantics, in memory:
// messages arrive once, in order, asynchronously; a break holds them until
// both ends are connected again (PeerConnect keeps them in the sender's queue).

import type { Transport } from '../src/lib/walletpair/client';

type State = Transport['state'];

export class MemoryTransport extends EventTarget implements Transport {
  state: State = 'connected';
  peer!: MemoryTransport;
  /** Messages sent while apart, delivered when both are connected. */
  readonly outbox: Uint8Array[] = [];
  /** Everything this end sent, for assertions. */
  readonly sent: Uint8Array[] = [];
  /** When set, sent messages are dropped instead of delivered (simulates a restart losing them). */
  drop = false;

  send(data: Uint8Array): number {
    if (this.state === 'closed') throw new Error('room is closed');
    this.sent.push(data);
    if (!this.drop) {
      this.outbox.push(data);
      this.#flush();
    }
    return this.sent.length - 1;
  }

  /** Simulates going offline and coming back. */
  setState(state: State): void {
    this.state = state;
    this.dispatchEvent(new Event('state'));
    if (state === 'connected') {
      this.#flush();
      this.peer.#flush();
    }
  }

  /** Ends the room for both ends, as PeerConnect's close does once acknowledged. */
  close(): void {
    for (const end of [this, this.peer]) {
      end.outbox.length = 0;
      end.setState('closed');
    }
  }

  #flush(): void {
    queueMicrotask(() => {
      while (this.state === 'connected' && this.peer.state === 'connected' && this.outbox.length) {
        const data = this.outbox.shift()!;
        this.peer.dispatchEvent(new MessageEvent('message', { data }));
      }
    });
  }
}

export function memoryPair(): [MemoryTransport, MemoryTransport] {
  const a = new MemoryTransport();
  const b = new MemoryTransport();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

/** Lets queued microtasks and timers run. */
export const settle = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
