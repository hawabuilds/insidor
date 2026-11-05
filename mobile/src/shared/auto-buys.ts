/**
 * AUTO BUY ON A WATCHED POST, the app's side (the owner, 2026-11-05): whether this person may set
 * one, the sheet's choices, and the auto buys they have on, read from the alert service
 * (services/notify auto-buy.ts) and kept in one place the feed's cards and the sheet both read.
 *
 * Its own store, like watched-posts.ts, so a card's strip and the sheet can never disagree about
 * whether a post has an auto buy: the sheet saves here, the strip draws from here.
 *
 * ★ NOT ALLOWED UNTIL THE SERVER SAYS SO. Until `config` has been read, `allowed` is false and no
 * sheet or strip is drawn; a read that fails stays not allowed. While it is owner-only, everyone
 * else is told `allowed: false` and sees today's star and nothing more.
 *
 * What breaks if changed carelessly: amounts are lamports, whole numbers, never SOL floats; the
 * server checks every number again, so a choice not in the config is refused there.
 */

import { useSyncExternalStore } from 'react';

import { notifyCall } from './api/people.ts';

export type Speed = 'normal' | 'fast' | 'turbo';

export interface AutoBuy {
  readonly itemId: string;
  readonly lamports: number;
  readonly maxCapUsd: number | null;
  readonly pvpCoins: number;
  readonly speed: Speed;
  readonly slippageBps: number;
  readonly activeUntil: number;
}

export interface AutoBuyChoices {
  readonly amountsLamports: readonly number[];
  readonly capsUsd: readonly number[];
  readonly slippagesBps: readonly number[];
  readonly activeMs: readonly number[];
  readonly maxPvpCoins: number;
  readonly maxLamports: number;
  readonly feeLamports: Readonly<Record<Speed, number>>;
}

export interface AutoBuySettings {
  readonly lamports: number;
  readonly maxCapUsd: number | null;
  readonly pvpCoins: number;
  readonly speed: Speed;
  readonly slippageBps: number;
  readonly activeMs: number;
}

type Listener = () => void;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.flatMap((x) => (num(x) === null ? [] : [x as number])) : []);

function readBuy(v: unknown): AutoBuy | null {
  const b = v as Record<string, unknown> | null;
  if (b === null || typeof b !== 'object' || typeof b['itemId'] !== 'string') return null;
  const lamports = num(b['lamports']);
  const until = num(b['activeUntil']);
  const speed = b['speed'];
  if (lamports === null || until === null || (speed !== 'normal' && speed !== 'fast' && speed !== 'turbo')) return null;
  return { itemId: b['itemId'], lamports, maxCapUsd: num(b['maxCapUsd']), pvpCoins: num(b['pvpCoins']) ?? 1, speed, slippageBps: num(b['slippageBps']) ?? 0, activeUntil: until };
}

function createAutoBuys() {
  let allowed = false;
  let choices: AutoBuyChoices | null = null;
  let buys: ReadonlyMap<string, AutoBuy> = new Map();
  let version = 0;
  const listeners = new Set<Listener>();
  const changed = () => {
    version += 1;
    for (const l of listeners) l();
  };
  const path = (itemId: string) => `/auto-buy/${encodeURIComponent(itemId)}`;
  return {
    allowed: () => allowed,
    choices: () => choices,
    get: (itemId: string): AutoBuy | null => {
      const b = buys.get(itemId) ?? null;
      return b !== null && b.activeUntil > Date.now() ? b : null;
    },
    version: () => version,
    subscribe(l: Listener) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    /** Read the config, then (only when allowed) my auto buys. Signed in. A failure leaves it not allowed. */
    async load(): Promise<void> {
      try {
        const c = (await notifyCall('GET', '/auto-buy/config')) as Record<string, unknown>;
        const ch = (c['choices'] ?? {}) as Record<string, unknown>;
        const fee = (c['feeLamports'] ?? {}) as Record<string, unknown>;
        allowed = c['allowed'] === true;
        choices = {
          amountsLamports: nums(ch['amountsLamports']),
          capsUsd: nums(ch['capsUsd']),
          slippagesBps: nums(ch['slippagesBps']),
          activeMs: nums(ch['activeMs']),
          maxPvpCoins: num(ch['maxPvpCoins']) ?? 1,
          maxLamports: num(ch['maxLamports']) ?? 0,
          feeLamports: { normal: num(fee['normal']) ?? 0, fast: num(fee['fast']) ?? 0, turbo: num(fee['turbo']) ?? 0 },
        };
        if (allowed) {
          const r = (await notifyCall('GET', '/auto-buy')) as { buys?: unknown };
          const list = Array.isArray(r.buys) ? r.buys.flatMap((b) => readBuy(b) ?? []) : [];
          buys = new Map(list.map((b) => [b.itemId, b]));
        }
      } catch {
        allowed = false;
      }
      changed();
    },
    /** Save; resolves with the saved auto buy when the server agrees, rejects with its reason when it does not. */
    async save(itemId: string, s: AutoBuySettings): Promise<AutoBuy> {
      const r = (await notifyCall('PUT', path(itemId), s)) as { buy?: unknown };
      const saved = readBuy(r.buy);
      if (saved === null) throw new Error("Couldn't save auto buy.");
      buys = new Map([...buys, [itemId, saved]]);
      changed();
      return saved;
    },
    async off(itemId: string): Promise<void> {
      await notifyCall('DELETE', path(itemId));
      const next = new Map(buys);
      next.delete(itemId);
      buys = next;
      changed();
    },
  };
}

/** The one store the app uses. */
export const autoBuys = createAutoBuys();

/** Re-renders on any change to the store. */
export function useAutoBuys(): typeof autoBuys {
  useSyncExternalStore(autoBuys.subscribe, autoBuys.version, autoBuys.version);
  return autoBuys;
}
