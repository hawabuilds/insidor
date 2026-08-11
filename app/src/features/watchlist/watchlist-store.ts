/**
 * SAVED STORIES, and the alert that fires when one of them mints.
 *
 * The alert is the product's headline moment: a coin is minted within about two minutes of
 * the source post but takes about six days to peak, so the useful notification is not "you
 * missed it" — it is "the thing you were watching just got a coin, and it is still early."
 *
 * Two decisions worth naming:
 *
 *   - The watchlist is local. There is no account yet, and inventing a server-side one to
 *     hold a list of ids would be the largest thing in this package. When auth lands, this
 *     module gains a sync method and nothing else changes.
 *   - Alerts fire off the board's own coin link, not off a separate feed. A watched story
 *     whose link moves from `none` or `unsure` to a settled coin is exactly the event, and
 *     deriving it from the data already arriving means there is no second source of truth
 *     that can disagree with the board the user is looking at.
 *
 * No React here, for the same reason as the board store: the transition rule is testable
 * without a renderer.
 */

import type { CoinLink } from '../../shared/api/index.ts';

const STORAGE_KEY = 'insidor.watchlist.v1';

export interface MintAlert {
  readonly storyId: string;
  readonly ticker: string;
  readonly coinId: string;
  readonly at: number;
}

export type WatchListener = () => void;

export interface WatchStore {
  ids(): readonly string[];
  has(storyId: string): boolean;
  toggle(storyId: string): void;
  alerts(): readonly MintAlert[];
  dismiss(storyId: string): void;
  /**
   * Feed the current coin link for a watched story. Returns the alert if this observation
   * is the transition, so the caller can also make a noise. Idempotent: the same settled
   * coin observed twice fires once.
   */
  observe(storyId: string, coins: CoinLink, now: number): MintAlert | null;
  subscribe(l: WatchListener): () => void;
}

/** A settled coin, or nothing. `unsure` is not a mint event — that is the whole distinction. */
function settledCoin(coins: CoinLink): { coinId: string; ticker: string } | null {
  if (coins.kind !== 'one') return null;
  return { coinId: coins.coin.coinId, ticker: coins.coin.ticker };
}

function load(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    /* A corrupt or unavailable store is an empty watchlist, not a crash on first paint. */
    return [];
  }
}

function save(ids: readonly string[]): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* Private-mode browsers refuse writes. Losing the list is survivable; throwing is not. */
  }
}

export function createWatchStore(): WatchStore {
  let ids: readonly string[] = load();
  let fired: readonly MintAlert[] = [];
  /* Which coin we have already alerted for, per story, so a re-observation is silent. */
  const alerted = new Map<string, string>();
  const listeners = new Set<WatchListener>();

  function emit(): void {
    for (const l of listeners) l();
  }

  return {
    ids: () => ids,
    has: (storyId) => ids.includes(storyId),

    toggle(storyId) {
      ids = ids.includes(storyId) ? ids.filter((id) => id !== storyId) : [...ids, storyId];
      if (!ids.includes(storyId)) {
        alerted.delete(storyId);
        fired = fired.filter((a) => a.storyId !== storyId);
      }
      save(ids);
      emit();
    },

    alerts: () => fired,

    dismiss(storyId) {
      fired = fired.filter((a) => a.storyId !== storyId);
      emit();
    },

    observe(storyId, coins, now) {
      if (!ids.includes(storyId)) return null;
      const settled = settledCoin(coins);
      if (!settled) return null;
      if (alerted.get(storyId) === settled.coinId) return null;

      alerted.set(storyId, settled.coinId);
      const alert: MintAlert = {
        storyId,
        ticker: settled.ticker,
        coinId: settled.coinId,
        at: now,
      };
      fired = [alert, ...fired];
      emit();
      return alert;
    },

    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
