// What a Wallet shows the user about a request, decoded from what will be
// signed (spec/core.md §8, "Inputs"). Shared by the CLI wallet and the
// website's demo wallet.

import { methodName, NAMESPACE_NAMES } from '../lib/display';
import { base64Decode, bytesToHex, hexToBytes, isUtf8 } from '../lib/walletpair/codec';
import { parseTransaction } from '../lib/walletpair/networks/solana-transaction';
import { tronAccount } from '../lib/walletpair/networks/tron';
import { parseTronRaw } from '../lib/walletpair/networks/tron-transaction';
import type { ConnectParams, Request } from '../lib/walletpair/protocol';

export interface Description {
  title: string;
  /** The site asking, as the DApp side asserted it. */
  origin?: string;
  fields: [label: string, value: string][];
}

/** Bytes as text when they are UTF-8, otherwise as hexadecimal. */
export function showBytes(bytes: Uint8Array): string {
  return isUtf8(bytes) ? new TextDecoder().decode(bytes) : `0x${bytesToHex(bytes)}`;
}

const TRON_CONTRACTS: Record<number, string> = {
  1: 'TRX transfer (TransferContract)',
  2: 'TRC-10 transfer (TransferAssetContract)',
  31: 'Contract call (TriggerSmartContract)',
};

export function describeConnect(params: ConnectParams, offered: string[], origin?: string): Description {
  const fields: [string, string][] = [['DApp', params.name]];
  if (params.url) fields.push(['URL', params.url]);
  fields.push(['Networks', offered.map((ns) => NAMESPACE_NAMES[ns] ?? ns).join(', ')]);
  return { title: 'Connect', origin, fields };
}

export function describeRequest(request: Request): Description {
  const p = request.params as any;
  const description: Description = { title: methodName(request.method), origin: request.origin, fields: [] };
  const add = (label: string, value: string) => description.fields.push([label, value]);
  try {
    switch (request.method) {
      case 'personal_sign':
        add('Account', p[1]);
        add('Message', showBytes(hexToBytes(p[0].slice(2))!));
        break;
      case 'eth_signTypedData_v4': {
        const typed = JSON.parse(p[1]);
        add('Account', p[0]);
        add('Type', typed.primaryType);
        add('Domain', JSON.stringify(typed.domain));
        add('Message', JSON.stringify(typed.message, null, 1));
        break;
      }
      case 'eth_sendTransaction': {
        const tx = p[0];
        add('From', tx.from);
        if (tx.to) add('To', tx.to);
        add('Value', `${BigInt(tx.value ?? '0x0')} wei`);
        if (tx.data ?? tx.input) add('Data', tx.data ?? tx.input);
        if (tx.chainId) add('Chain', `eip155:${BigInt(tx.chainId)}`);
        break;
      }
      case 'wallet_sendCalls':
        add('Chain', `eip155:${BigInt(p[0].chainId)}`);
        add('Calls', JSON.stringify(p[0].calls, null, 1));
        break;
      case 'wallet_switchEthereumChain':
      case 'wallet_addEthereumChain':
        add('Chain', `eip155:${BigInt(p[0].chainId)}${p[0].chainName ? ` (${p[0].chainName})` : ''}`);
        break;
      case 'tron_signMessage':
        add('Account', p.account);
        add('Message', showBytes(hexToBytes(p.message)!));
        break;
      case 'tron_signTransaction': {
        const tx = parseTronRaw(hexToBytes(p.transaction)!);
        const owner = tx?.contract.owner ? tronAccount(tx.contract.owner) : 'unknown';
        add('Account', p.account);
        add('Contract', TRON_CONTRACTS[tx?.contract.type ?? -1] ?? `Contract type ${tx?.contract.type}`);
        add('Owner', owner === p.account ? owner : `${owner} (signing for another account: multi-signature)`);
        if (tx?.expiration) add('Expires', new Date(Number(tx.expiration)).toISOString());
        break;
      }
      case 'tron_switchChain':
        add('Chain', p.chain);
        break;
      case 'solana_signTransactions':
      case 'solana_signAndSendTransaction': {
        const list: string[] = p.transactions ?? [p.transaction];
        const parsed = list.map((t) => parseTransaction(base64Decode(t)!));
        add('Account', p.account);
        if (p.chain) add('Chain', p.chain);
        add(
          'Transactions',
          parsed.map((t) => `${t?.version === 0 ? 'v0' : t?.version}, ${t?.numRequiredSignatures} signer(s)`).join('; '),
        );
        if (request.method === 'solana_signAndSendTransaction') add('Sent', 'after signing');
        break;
      }
      case 'solana_signMessage':
        add('Account', p.account);
        add('Message', showBytes(base64Decode(p.message)!));
        break;
      default:
        add('Params', JSON.stringify(p));
    }
  } catch {
    description.fields = [['Params', JSON.stringify(p)]];
  }
  return description;
}
