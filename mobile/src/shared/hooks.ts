/**
 * Small React hooks shared by more than one screen: the clock, the watchlist, and an async
 * load with its three honest states.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
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
  | { readonly state: 'ready'; readonly value: T };

/**
 * Run `load` when `key` changes and hold its outcome. A failure is kept as a failure — the
 * screen says it could not read, rather than rendering an empty list that looks like a quiet
 * world. `reload` re-runs it, and an earlier run that lands late is ignored.
 */
export function useLoad<T>(key: string, load: (signal: AbortSignal) => Promise<T>): [Load<T>, () => void] {
  const [result, setResult] = useState<Load<T>>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    setResult((prev) => (prev.state === 'ready' ? prev : { state: 'loading' }));
    load(ac.signal).then(
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
