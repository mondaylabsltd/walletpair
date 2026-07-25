import { describe, it, expect } from 'vitest';
import { ethereumHandler } from '../handler';

describe('ethereumHandler.handleLocalMethod', () => {
  const state = (over: Record<string, unknown> = {}) =>
    ({ isConnected: false, accounts: [] as string[], chainRef: '1', ...over }) as any;

  it('answers wallet_getPermissions per EIP-2255 by connection state', () => {
    expect(ethereumHandler.handleLocalMethod('wallet_getPermissions', undefined, state())).toEqual([]);
    expect(
      ethereumHandler.handleLocalMethod(
        'wallet_getPermissions',
        undefined,
        state({ isConnected: true, accounts: ['0xabc'] }),
      ),
    ).toEqual([{ parentCapability: 'eth_accounts' }]);
  });

  it('handles every method it advertises as local (no advertised-but-throwing method)', () => {
    for (const method of ethereumHandler.localMethods) {
      expect(() =>
        ethereumHandler.handleLocalMethod(method, undefined, state({ isConnected: true, accounts: ['0xabc'] })),
      ).not.toThrow();
    }
  });
});
