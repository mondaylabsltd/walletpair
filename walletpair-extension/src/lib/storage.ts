import { browser } from 'wxt/browser';
import { DEFAULT_RELAY_URL, STORAGE_KEYS } from './constants';
import type { ActivityEntry, ExtensionSettings } from './types';
import type { SessionState, WalletInfo } from './walletpair/protocol';

const defaults: ExtensionSettings = {
  relayUrl: DEFAULT_RELAY_URL,
  rpcUrls: {},
};

async function read<T>(key: string, fallback: T): Promise<T> {
  const result = await browser.storage.local.get(key);
  return (result[key] as T | undefined) ?? fallback;
}

function write(key: string, value: unknown): Promise<void> {
  return value === undefined ? browser.storage.local.remove(key) : browser.storage.local.set({ [key]: value });
}

// Read-modify-write updates of one key run one at a time, so concurrent
// updates (two sites approved at once, say) cannot lose each other's writes.
const locks = new Map<string, Promise<void>>();

function update<T>(key: string, fallback: T, change: (value: T) => T | undefined): Promise<void> {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.then(async () => write(key, change(await read(key, fallback))));
  locks.set(key, next.catch(() => {}));
  return next;
}

// ── Settings ──

export async function getSettings(): Promise<ExtensionSettings> {
  return { ...defaults, ...(await read<Partial<ExtensionSettings>>(STORAGE_KEYS.SETTINGS, {})) };
}

export function saveSettings(settings: Partial<ExtensionSettings>): Promise<void> {
  return update<Partial<ExtensionSettings>>(STORAGE_KEYS.SETTINGS, {}, (current) => ({ ...current, ...settings }));
}

/** A PeerConnect relay URL: `ws://` or `wss://`, a host, no query, fragment or trailing slash. */
export function isRelayUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'wss:' || url.protocol === 'ws:') &&
      url.host !== '' &&
      !url.search &&
      !url.hash &&
      !value.endsWith('/') &&
      !value.includes('#')
    );
  } catch {
    return false;
  }
}

// ── Session ──

export const getRoom = (): Promise<string | undefined> => read<string | undefined>(STORAGE_KEYS.ROOM, undefined);
export const saveRoom = (record: string | undefined): Promise<void> => update(STORAGE_KEYS.ROOM, undefined, () => record);

export interface ClosingRoom {
  record: string;
  /** When closing started, to stop trying after a while (PeerConnect §5.5). */
  since: number;
}

/** Rooms being closed, by room id. */
export const getClosingRooms = (): Promise<Record<string, ClosingRoom>> =>
  read<Record<string, ClosingRoom>>(STORAGE_KEYS.CLOSING, {});

export function setClosingRoom(id: string, room: ClosingRoom | undefined): Promise<void> {
  return update<Record<string, ClosingRoom>>(STORAGE_KEYS.CLOSING, {}, ({ [id]: _, ...others }) => {
    const rooms = room ? { ...others, [id]: room } : others;
    return Object.keys(rooms).length ? rooms : undefined;
  });
}

export interface SessionCache {
  wallet?: WalletInfo;
  state: SessionState;
}

export const getSessionCache = (): Promise<SessionCache | undefined> =>
  read<SessionCache | undefined>(STORAGE_KEYS.SESSION, undefined);
export const saveSessionCache = (cache: SessionCache | undefined): Promise<void> =>
  update(STORAGE_KEYS.SESSION, undefined, () => cache);

export const getPendingIds = (): Promise<string[]> => read<string[]>(STORAGE_KEYS.PENDING, []);
export const savePendingIds = (ids: string[]): Promise<void> =>
  update<string[]>(STORAGE_KEYS.PENDING, [], () => (ids.length ? ids : undefined));

// ── Sites ──

/** origin → namespaces the user let the site use. */
export type Sites = Record<string, string[]>;

export const getSites = (): Promise<Sites> => read<Sites>(STORAGE_KEYS.SITES, {});

export function grantSite(origin: string, namespace: string): Promise<void> {
  return update<Sites>(STORAGE_KEYS.SITES, {}, (sites) => {
    const granted = sites[origin] ?? [];
    return granted.includes(namespace) ? sites : { ...sites, [origin]: [...granted, namespace] };
  });
}

/** Revokes one namespace, or every namespace when none is given. */
export function revokeSite(origin: string, namespace?: string): Promise<void> {
  return update<Sites>(STORAGE_KEYS.SITES, {}, (sites) => {
    const { [origin]: granted = [], ...others } = sites;
    const kept = namespace ? granted.filter((ns) => ns !== namespace) : [];
    return kept.length ? { ...others, [origin]: kept } : others;
  });
}

export const clearSites = (): Promise<void> => update<Sites>(STORAGE_KEYS.SITES, {}, () => undefined);

// ── Activity ──

const MAX_ACTIVITY = 50;

export const getActivityLog = (): Promise<ActivityEntry[]> => read<ActivityEntry[]>(STORAGE_KEYS.ACTIVITY, []);

export function addActivityEntry(entry: ActivityEntry): Promise<void> {
  return update<ActivityEntry[]>(STORAGE_KEYS.ACTIVITY, [], (log) => [entry, ...log].slice(0, MAX_ACTIVITY));
}

export function updateActivity(id: string, change: Partial<ActivityEntry>): Promise<void> {
  return update<ActivityEntry[]>(STORAGE_KEYS.ACTIVITY, [], (log) =>
    log.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)),
  );
}

export const clearActivityLog = (): Promise<void> => update(STORAGE_KEYS.ACTIVITY, [], () => undefined);
