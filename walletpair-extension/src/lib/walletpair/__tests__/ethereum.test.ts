import { describe, expect, it } from 'vitest';
import { classifyEthereumMessage, createEthereumRequest } from '../ethereum';

describe('Ethereum channel messages', () => {
  it('uses the minimal request, response and event shapes', () => {
    expect(createEthereumRequest('req-1', 'eth_chainId')).toEqual({ id: 'req-1', method: 'eth_chainId' });
    expect(classifyEthereumMessage({ id: 'req-1', result: '0x1' })).toMatchObject({ kind: 'response' });
    expect(classifyEthereumMessage({ event: 'chainChanged', data: '0x1' })).toMatchObject({ kind: 'event' });
  });

  it('rejects ambiguous messages, unexpected fields and invalid ids', () => {
    expect(() => classifyEthereumMessage({ id: 'req-1', method: 'eth_chainId', result: '0x1' })).toThrow(/ambiguous|invalid/);
    expect(() => classifyEthereumMessage({ id: 'req-1', result: '0x1', extra: true })).toThrow(/unexpected/);
    expect(() => createEthereumRequest('\n', 'eth_chainId')).toThrow(/printable ASCII/);
  });

  it('requires exactly one of result or error in a response', () => {
    expect(() => classifyEthereumMessage({ id: 'req-1' })).toThrow();
    expect(() => classifyEthereumMessage({ id: 'req-1', result: null, error: { code: 4001, message: 'Rejected' } })).toThrow();
    expect(classifyEthereumMessage({ id: 'req-1', error: { code: 4001, message: 'Rejected' } })).toMatchObject({
      kind: 'response',
      message: { error: { code: 4001, message: 'Rejected' } },
    });
  });
});
