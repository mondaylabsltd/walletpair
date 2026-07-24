import { describe, it, expect, beforeEach, vi } from 'vitest';
import { READ_ONLY_METHODS, proxyRpcCall, DEFAULT_RPC } from '../lib/rpc-proxy';
import { isSafeRpcUrl, __resetRpcProxyCaches } from '../lib/protocols/ethereum/rpc-proxy';

// ── Mock chrome.storage.local (needed by getSettings) ──────────────────

const store: Record<string, unknown> = {};

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: store[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => Object.assign(store, items)),
      remove: vi.fn(async (key: string) => { delete store[key]; }),
    },
  },
});

// ── Mock global fetch ──────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/** Helper: build a mock Response matching our proxyRpcCall expectations. */
function mockJsonResponse(body: unknown, opts?: { ok?: boolean; status?: number; statusText?: string }) {
  const text = JSON.stringify(body);
  return {
    ok: opts?.ok ?? true,
    status: opts?.status ?? 200,
    statusText: opts?.statusText ?? 'OK',
    headers: {
      get: (key: string) => key.toLowerCase() === 'content-length' ? String(text.length) : null,
    },
    text: async () => text,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('READ_ONLY_METHODS', () => {
  it('contains common read-only Ethereum JSON-RPC methods', () => {
    const expected = [
      'eth_blockNumber',
      'eth_call',
      'eth_estimateGas',
      'eth_getBalance',
      'eth_getTransactionByHash',
      'eth_getTransactionReceipt',
      'eth_getLogs',
      'eth_getBlockByNumber',
      'eth_gasPrice',
      'eth_syncing',
    ];
    for (const method of expected) {
      expect(READ_ONLY_METHODS.has(method)).toBe(true);
    }
  });

  it('does not contain wallet-interaction methods', () => {
    const walletMethods = [
      'eth_sendTransaction',
      'eth_requestAccounts',
      'personal_sign',
      'eth_signTypedData_v4',
      'wallet_switchEthereumChain',
    ];
    for (const method of walletMethods) {
      expect(READ_ONLY_METHODS.has(method)).toBe(false);
    }
  });

  it('excludes eth_sendRawTransaction because it submits data to the network', () => {
    expect(READ_ONLY_METHODS.has('eth_sendRawTransaction')).toBe(false);
  });
});

describe('isSafeRpcUrl (SSRF guard for untrusted RPC URLs)', () => {
  it('accepts public HTTPS endpoints', () => {
    for (const url of Object.values(DEFAULT_RPC)) {
      expect(isSafeRpcUrl(url)).toBe(true);
    }
    expect(isSafeRpcUrl('https://rpc.example.com/v1')).toBe(true);
  });

  it('rejects non-HTTPS schemes', () => {
    expect(isSafeRpcUrl('http://eth.llamarpc.com')).toBe(false);
    expect(isSafeRpcUrl('ws://eth.llamarpc.com')).toBe(false);
    expect(isSafeRpcUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeRpcUrl('not a url')).toBe(false);
  });

  it('rejects loopback, localhost, and cloud metadata', () => {
    expect(isSafeRpcUrl('https://localhost/rpc')).toBe(false);
    expect(isSafeRpcUrl('https://app.localhost/rpc')).toBe(false);
    expect(isSafeRpcUrl('https://127.0.0.1:8545')).toBe(false);
    expect(isSafeRpcUrl('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isSafeRpcUrl('https://[::1]/rpc')).toBe(false);
  });

  it('rejects private and CGNAT IPv4 ranges', () => {
    expect(isSafeRpcUrl('https://10.0.0.5')).toBe(false);
    expect(isSafeRpcUrl('https://172.16.3.4')).toBe(false);
    expect(isSafeRpcUrl('https://172.31.255.1')).toBe(false);
    expect(isSafeRpcUrl('https://192.168.1.1')).toBe(false);
    expect(isSafeRpcUrl('https://100.64.0.1')).toBe(false);
    // Public IPs adjacent to private ranges remain allowed.
    expect(isSafeRpcUrl('https://172.32.0.1')).toBe(true);
    expect(isSafeRpcUrl('https://8.8.8.8')).toBe(true);
  });

  it('rejects unique-local and link-local IPv6', () => {
    expect(isSafeRpcUrl('https://[fd00::1]/rpc')).toBe(false);
    expect(isSafeRpcUrl('https://[fe80::1]/rpc')).toBe(false);
  });
});

describe('proxyRpcCall', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    __resetRpcProxyCaches();
    vi.clearAllMocks();
  });

  /**
   * Mock the eth_chainId verification probe the proxy issues before any read
   * (ethereum.md requires confirming the endpoint's chain matches the selection).
   */
  function mockChainIdProbe(chainId: number) {
    return mockJsonResponse({ jsonrpc: '2.0', id: 1, result: `0x${chainId.toString(16)}` });
  }

  /** The actual read fetch (the one whose body method is not the eth_chainId probe). */
  function rpcCall() {
    return mockFetch.mock.calls.find((c: any) => {
      try { return JSON.parse(c[1].body).method !== 'eth_chainId'; } catch { return false; }
    });
  }

  it('verifies the endpoint chain, then sends a correct JSON-RPC POST request', async () => {
    mockFetch
      .mockResolvedValueOnce(mockChainIdProbe(1))
      .mockResolvedValueOnce(mockJsonResponse({ jsonrpc: '2.0', id: 1, result: '0x10' }));

    const result = await proxyRpcCall(1, 'eth_blockNumber', []);

    // First fetch is the eth_chainId verification probe; second is the read.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).method).toBe('eth_chainId');

    const [url, options] = rpcCall()!;
    expect(url).toBe('https://eth.llamarpc.com');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(options.body);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.method).toBe('eth_blockNumber');
    expect(body.params).toEqual([]);

    expect(result).toBe('0x10');
  });

  it('uses user-configured RPC URL over default', async () => {
    store['settings'] = { rpcUrls: { 1: 'https://custom-rpc.example.com' } };

    mockFetch
      .mockResolvedValueOnce(mockChainIdProbe(1))
      .mockResolvedValueOnce(mockJsonResponse({ jsonrpc: '2.0', id: 1, result: '0x5' }));

    await proxyRpcCall(1, 'eth_blockNumber', []);

    expect(rpcCall()![0]).toBe('https://custom-rpc.example.com');
  });

  it('falls back to DEFAULT_RPC when settings have no URL for chain', async () => {
    store['settings'] = { rpcUrls: {} };

    mockFetch
      .mockResolvedValueOnce(mockChainIdProbe(137))
      .mockResolvedValueOnce(mockJsonResponse({ jsonrpc: '2.0', id: 1, result: '0x1' }));

    await proxyRpcCall(137, 'eth_blockNumber', []);

    expect(rpcCall()![0]).toBe(DEFAULT_RPC[137]);
  });

  it('rejects an endpoint whose eth_chainId does not match the selected chain', async () => {
    // Endpoint answers eth_chainId with 0x89 (137) for a chain-12345 request; no
    // DEFAULT_RPC for 12345 and discovery finds nothing → 4901, read never sent.
    store['settings'] = { rpcUrls: { 12345: 'https://wrong-chain.example.com' } };
    mockFetch
      .mockResolvedValueOnce(mockChainIdProbe(137))
      .mockResolvedValue(mockJsonResponse({}, { ok: false, status: 404 }));

    try {
      await proxyRpcCall(12345, 'eth_blockNumber', []);
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe(4901);
    }
    expect(rpcCall()).toBeUndefined();
  });

  it('throws with code 4901 when no endpoint can serve the chain', async () => {
    store['settings'] = { rpcUrls: {} };
    mockFetch.mockResolvedValue(mockJsonResponse({}, { ok: false, status: 404 }));

    try {
      await proxyRpcCall(99999, 'eth_blockNumber', []);
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('No usable RPC endpoint for chain 99999');
      expect(err.code).toBe(4901);
    }
  });

  it('throws with code -32603 on HTTP error', async () => {
    mockFetch
      .mockResolvedValueOnce(mockChainIdProbe(1)) // verification passes
      .mockResolvedValueOnce({ ok: false, status: 502, statusText: 'Bad Gateway' }) // read 502 (transient)
      .mockResolvedValue(mockJsonResponse({}, { ok: false, status: 404 })); // discovery → null

    try {
      await proxyRpcCall(1, 'eth_blockNumber', []);
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('502');
      expect(err.code).toBe(-32603);
    }
  });

  it('throws with RPC error code when JSON-RPC response contains error', async () => {
    mockFetch
      .mockResolvedValueOnce(mockChainIdProbe(1))
      .mockResolvedValueOnce(mockJsonResponse({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32000, message: 'execution reverted' },
      }));

    try {
      await proxyRpcCall(1, 'eth_call', [{ to: '0x0', data: '0x' }, 'latest']);
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.message).toBe('execution reverted');
      expect(err.code).toBe(-32000);
    }
  });

  it('passes params through to the RPC body', async () => {
    mockFetch
      .mockResolvedValueOnce(mockChainIdProbe(1))
      .mockResolvedValueOnce(mockJsonResponse({ jsonrpc: '2.0', id: 1, result: '0x0' }));

    const params = [{ to: '0xdead', data: '0x1234' }, 'latest'];
    await proxyRpcCall(1, 'eth_call', params);

    expect(JSON.parse(rpcCall()![1].body).params).toEqual(params);
  });

  it('defaults params to empty array when null/undefined', async () => {
    mockFetch
      .mockResolvedValueOnce(mockChainIdProbe(1))
      .mockResolvedValueOnce(mockJsonResponse({ jsonrpc: '2.0', id: 1, result: '0x5' }));

    await proxyRpcCall(1, 'eth_blockNumber', null);

    expect(JSON.parse(rpcCall()![1].body).params).toEqual([]);
  });

  it('includes AbortSignal for timeout', async () => {
    mockFetch
      .mockResolvedValueOnce(mockChainIdProbe(1))
      .mockResolvedValueOnce(mockJsonResponse({ jsonrpc: '2.0', id: 1, result: '0x1' }));

    await proxyRpcCall(1, 'eth_blockNumber', []);

    const [, options] = rpcCall()!;
    expect(options.signal).toBeDefined();
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws on oversized response', async () => {
    mockFetch
      .mockResolvedValueOnce(mockChainIdProbe(1))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (key: string) => key.toLowerCase() === 'content-length' ? '10000000' : null,
        },
        text: async () => 'x'.repeat(10000000),
      });

    try {
      await proxyRpcCall(1, 'eth_blockNumber', []);
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('too large');
      expect(err.code).toBe(-32603);
    }
  });
});
