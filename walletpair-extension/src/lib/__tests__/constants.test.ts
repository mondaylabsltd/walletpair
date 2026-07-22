import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RELAY_URL,
  MSG_CHANNEL,
  PROVIDER_UUID,
  STORAGE_KEYS,
} from '../constants';

describe('constants', () => {
  it('DEFAULT_RELAY_URL is a valid wss:// URL', () => {
    expect(DEFAULT_RELAY_URL).toMatch(/^wss:\/\/.+/);
    // Should parse as a valid URL
    const url = new URL(DEFAULT_RELAY_URL);
    expect(url.protocol).toBe('wss:');
  });

  it('MSG_CHANNEL is a non-empty string', () => {
    expect(typeof MSG_CHANNEL).toBe('string');
    expect(MSG_CHANNEL.length).toBeGreaterThan(0);
  });

  it('PROVIDER_UUID matches UUID format', () => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(PROVIDER_UUID).toMatch(uuidRegex);
  });

  it('STORAGE_KEYS values are all unique strings', () => {
    const values = Object.values(STORAGE_KEYS);
    expect(values.length).toBeGreaterThan(0);

    for (const v of values) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }

    // All values should be unique
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});
