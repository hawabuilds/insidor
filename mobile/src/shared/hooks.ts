/**
 * Small React hooks shared by more than one screen: the clock, the watchlist, and an async
 * load with its three honest states (and, when asked, the last answer shown while it reads).
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { fresh, kept as keptRead } from './kept-reads.ts';
import { watchlist } from './watchlist.ts';

/**
 * The time, for ages. One value per render pass, so every row in a paint agrees on what time
 * it is, and refreshed on a slow beat — an age is shown to the minute, not the second.
 */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export function useWatchlist(): readonly string[] {
  return useSyncExternalStore(watchlist.subscribe, watchlist.ids, watchlist.ids);
}

export type Load<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly error: unknown }
  /* `stale`: the answer kept from an earlier read (shared/kept-reads.ts), shown while the fresh one is on its way. */
  | { readonly state: 'ready'; readonly value: T; readonly stale?: boolean };

/** Where a load's last answer is kept between visits (shared/kept-reads.ts): this visit only, or on the phone too. */
export type KeptIn = 'memory' | 'phone';

/**
 * Run `load` when `key` changes and hold its outcome. A failure is kept as a failure — the
 * screen says it could not read, rather than rendering an empty list that looks like a quiet
 * world. `reload` re-runs it, and an earlier run that lands late is ignored.
 *
 * With `kept`, the key's last answer is shown at once, marked `stale`, and the fresh read replaces
 * it in place; reads of the same key already on their way (a read ahead, another screen) are
 * shared rather than repeated. The key then names the read across the whole app.
 */
export function useLoad<T>(key: string, load: (signal: AbortSignal) => Promise<T>, kept?: KeptIn): [Load<T>, () => void] {
  const [result, setResult] = useState<Load<T>>(() => {
    const k = kept === undefined ? undefined : keptRead<T>(key);
    return k === undefined ? { state: 'loading' } : { state: 'ready', value: k.value, stale: true };
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    setResult((prev) => {
      const k = kept === undefined ? undefined : keptRead<T>(key);
      /* A new key shows its own kept answer; with none, what was showing stays until the read lands. */
      if (k !== undefined && (prev.state !== 'ready' || prev.value !== k.value)) return { state: 'ready', value: k.value, stale: true };
      return prev.state === 'ready' ? prev : { state: 'loading' };
    });
    (kept === undefined ? load(ac.signal) : fresh(key, load, kept === 'phone', ac.signal)).then(
      (value) => {
        if (!ac.signal.aborted) setResult({ state: 'ready', value });
      },
      (error: unknown) => {
        if (!ac.signal.aborted) setResult({ state: 'failed', error });
      },
    );
    return () => ac.abort();
    // `load` is a fresh closure every render; the key is what decides a reload.
  }, [key, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return [result, reload];
}
