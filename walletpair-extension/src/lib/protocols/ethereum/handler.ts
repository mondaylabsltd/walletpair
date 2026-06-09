/**
 * EVM ProtocolHandler implementation.
 *
 * Ties together the EVM method constants, RPC proxy, and formatters
 * into a single ProtocolHandler that the extension core can use.
 */
import type { ProtocolHandler, ProtocolState } from '../types';
import { CONFIRMATION_METHODS, LOCAL_METHODS, READ_ONLY_METHODS, UNSUPPORTED_METHODS } from './methods';
import { evmProxyRpcCall } from './rpc-proxy';
import { formatMethodName, formatDisplayValue, getChainName } from './formatters';

export const ethereumHandler: ProtocolHandler = {
  name: 'ethereum',
  namespace: 'eip155',
  windowPropertyName: 'ethereum',

  confirmationMethods: CONFIRMATION_METHODS,
  localMethods: LOCAL_METHODS,
  readOnlyMethods: READ_ONLY_METHODS,
  unsupportedMethods: UNSUPPORTED_METHODS,

  handleLocalMethod(method: string, _params: unknown, state: ProtocolState): unknown {
    switch (method) {
      case 'eth_chainId':
        return `0x${parseInt(state.chainRef || '1', 10).toString(16)}`;
      case 'net_version':
        return state.chainRef || '1';
      case 'eth_accounts':
        return state.isConnected ? [...state.accounts] : [];
      default:
        throw new Error(`Not a local method: ${method}`);
    }
  },

  proxyReadOnly(chainRef: string, method: string, params: unknown, customRpcUrls: Record<string, string>): Promise<unknown> {
    return evmProxyRpcCall(chainRef, method, params, customRpcUrls);
  },

  formatChainId(chainRef: string): string {
    return `0x${parseInt(chainRef, 10).toString(16)}`;
  },

  parseChainId(wireChainId: string): string {
    return String(parseInt(wireChainId, 16));
  },

  formatDisplayValue(amount: string, chainRef: string): string {
    return formatDisplayValue(amount, chainRef);
  },

  getChainName(chainRef: string): string {
    return getChainName(chainRef);
  },

  formatMethodName(method: string): string {
    return formatMethodName(method);
  },
};
