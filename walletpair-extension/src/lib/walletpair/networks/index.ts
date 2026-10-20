// The network specifications this implementation knows (spec/networks/).

import type { NamespaceRules } from '../protocol';
import { evm } from './evm';
import { solana } from './solana';
import { tron } from './tron';
import type { Network } from './types';

export const networkList: readonly Network[] = [evm, tron, solana];

export const namespaceRules: Record<string, NamespaceRules> = Object.fromEntries(
  networkList.map((network) => [network.namespace, network]),
);

export { evm, solana, tron };
export type { Network, WalletFunction } from './types';
