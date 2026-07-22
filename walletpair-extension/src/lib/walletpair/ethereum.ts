import type { JsonValue } from './msgpack';

export interface EthereumRequest {
  id: string;
  method: string;
  params?: JsonValue[] | { [key: string]: JsonValue };
}

export interface EthereumErrorData {
  code: number;
  message: string;
  data?: JsonValue;
}

export type EthereumResponse =
  | { id: string; result: JsonValue }
  | { id: string; error: EthereumErrorData };

export interface EthereumEvent {
  event: 'connect' | 'disconnect' | 'chainChanged' | 'accountsChanged' | 'message';
  data: JsonValue;
}

export class ProviderRpcError extends Error {
  readonly code: number;
  readonly data?: JsonValue;

  constructor(code: number, message: string, data?: JsonValue) {
    super(message);
    this.name = 'ProviderRpcError';
    this.code = code;
    this.data = data;
  }
}

export function createEthereumRequest(id: string, method: string, params?: unknown): EthereumRequest {
  validateRequestId(id);
  const methodBytes = new TextEncoder().encode(method).length;
  if (methodBytes < 1 || methodBytes > 128) throw new TypeError('method must be 1-128 UTF-8 bytes');
  if (params !== undefined && !Array.isArray(params) && !isRecord(params)) {
    throw new TypeError('EIP-1193 params must be an array or object');
  }
  const request: EthereumRequest = { id, method };
  if (params !== undefined) request.params = params as EthereumRequest['params'];
  return request;
}

export function classifyEthereumMessage(value: JsonValue):
  | { kind: 'request'; message: EthereumRequest }
  | { kind: 'response'; message: EthereumResponse }
  | { kind: 'event'; message: EthereumEvent } {
  if (!isRecord(value)) throw new TypeError('Ethereum plaintext must be an object');
  const hasId = hasOwn(value, 'id');
  const hasMethod = hasOwn(value, 'method');
  const hasResult = hasOwn(value, 'result');
  const hasError = hasOwn(value, 'error');
  const hasEvent = hasOwn(value, 'event');
  const hasData = hasOwn(value, 'data');
  const request = hasId && hasMethod && !hasResult && !hasError && !hasEvent;
  const response = hasId && !hasMethod && hasResult !== hasError && !hasEvent;
  const event = !hasId && !hasMethod && !hasResult && !hasError && hasEvent && hasData;
  if (Number(request) + Number(response) + Number(event) !== 1) {
    throw new TypeError('ambiguous or invalid Ethereum message shape');
  }

  if (request) {
    if (typeof value.id !== 'string' || typeof value.method !== 'string') throw new TypeError('invalid request fields');
    requireOnlyKeys(value, ['id', 'method', 'params']);
    return { kind: 'request', message: createEthereumRequest(value.id, value.method, value.params) };
  }
  if (response) {
    if (typeof value.id !== 'string') throw new TypeError('invalid response id');
    validateRequestId(value.id);
    requireOnlyKeys(value, hasError ? ['id', 'error'] : ['id', 'result']);
    if (hasError) {
      if (!isRecord(value.error) || !Number.isInteger(value.error.code) || typeof value.error.message !== 'string') {
        throw new TypeError('invalid ProviderRpcError');
      }
      requireOnlyKeys(value.error, ['code', 'message', 'data']);
      const error: EthereumErrorData = { code: value.error.code as number, message: value.error.message };
      if (hasOwn(value.error, 'data')) error.data = value.error.data;
      return { kind: 'response', message: { id: value.id, error } };
    }
    return { kind: 'response', message: { id: value.id, result: value.result } };
  }

  if (typeof value.event !== 'string' || !ETHEREUM_EVENTS.has(value.event)) {
    throw new TypeError('unsupported Ethereum event');
  }
  requireOnlyKeys(value, ['event', 'data']);
  return { kind: 'event', message: { event: value.event as EthereumEvent['event'], data: value.data } };
}

export function validateRequestId(id: string): void {
  if (!/^[\x20-\x7e]{1,128}$/.test(id)) throw new TypeError('request id must be 1-128 printable ASCII bytes');
}

function isRecord(value: unknown): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireOnlyKeys(value: object, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new TypeError('Ethereum message contains an unexpected field');
  }
}

const ETHEREUM_EVENTS = new Set(['connect', 'disconnect', 'chainChanged', 'accountsChanged', 'message']);
