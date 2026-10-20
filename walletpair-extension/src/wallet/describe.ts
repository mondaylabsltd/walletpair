// What a Wallet shows the user about a request, decoded from what will be
// signed (spec/core.md §8, "Inputs"). Shared by the CLI wallet and the
// website's demo wallet.

import { methodName, NAMESPACE_NAMES } from '../lib/display';
import { bytesToHex, hexToBytes, isUtf8 } from '../lib/walletpair/codec';
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
      default:
        add('Params', JSON.stringify(p));
    }
  } catch {
    description.fields = [['Params', JSON.stringify(p)]];
  }
  return description;
}
