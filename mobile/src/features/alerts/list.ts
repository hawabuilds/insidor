/**
 * THE FEED'S READ, A PAGE AT A TIME: one side of the alert service's list (the Feed by tab, or
 * Notifications), held with its three honest states, the cursor for the next page, and a refresh
 * that resolves when the first page has been read again (pull to refresh waits on it).
 *
 * Trador's paging (hooks/useSocialFeed.ts): twenty rows, then "Load more" with the cursor the last
 * page gave, until the cursor is null. A change of ask (another tab, the other window) is a
 * different list, read from its first page; a refresh starts over from the first page too.
 *
 * Separate from `useLoad` because that one's reload cannot be awaited, and a pull that lets go
 * before the read lands would stop spinning on the old list. A failed refresh keeps the list
 * already on screen rather than replacing it with an error: what was read is still true. A failed
 * "Load more" keeps the pages already read and leaves the button to try again.
 *
 * ★ THE LAST LIST READ OPENS THE SCREEN, AND A FAILED READ IS ASKED AGAIN QUIETLY (keep.ts says
 * why: on 2026-10-21 the alert service was down for nine minutes and every open said it could not
 * load). The list read last in this page's life, for this person and this ask, is on screen at once
 * while the new read is out; a read that fails leaves it there and is asked again after
 * `retryDelayMs`, while the screen is open, until one lands.
 *
 * What breaks if changed carelessly: the first read failing with nothing kept must still say so
 * (the screens say the feed could not be read), never fall through to an empty list that looks like
 * a quiet day. And an answer for an ask no longer on screen is dropped, or switching tabs fast would
 * show one tab's rows under another's name.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchAlerts, sessionToken, type Alert, type AlertListAsk } from '../../shared/api/people.ts';
import type { Load } from '../../shared/hooks.ts';
import { listKeeper, retryDelayMs, tokenSubject } from './keep.ts';

export type AlertList = { readonly alerts: readonly Alert[]; readonly cursor: string | null; readonly seenAt: number | null };

/** What each list read last, for this page's life (keep.ts). */
const KEPT = listKeeper<AlertList>();
const who = (): string | null => tokenSubject(sessionToken());

export function useAlertList(
  ask: AlertListAsk,
  key: string,
): { readonly list: Load<AlertList>; readonly fresh: boolean; readonly refresh: () => Promise<void>; readonly loadMore: () => void; readonly loadingMore: boolean } {
  const [list, setListState] = useState<Load<AlertList>>(() => {
    const kept = KEPT.get(who(), key);
    return kept === null ? { state: 'loading' } : { state: 'ready', value: kept };
  });
  const [loadingMore, setLoadingMore] = useState(false);
  /* A read has landed since this ask opened: what is on screen is not only the kept list. */
  const [fresh, setFresh] = useState(false);
  const alive = useRef(true);
  /* The ask on screen now; an answer for any other is dropped. */
  const current = useRef(key);
  const askRef = useRef(ask);
  askRef.current = ask;
  /* The quiet retry: one timer at most, and how many reads have failed in a row. */
  const retry = useRef<{ timer: ReturnType<typeof setTimeout> | null; failures: number }>({ timer: null, failures: 0 });

  /* Every list put on screen is also kept, for the next open. */
  const setList = useCallback((next: Load<AlertList> | ((prev: Load<AlertList>) => Load<AlertList>)) => {
    setListState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      if (value.state === 'ready') KEPT.set(who(), current.current, value.value);
      return value;
    });
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const asked = current.current;
    if (retry.current.timer !== null) {
      clearTimeout(retry.current.timer);
      retry.current.timer = null;
    }
    try {
      const page = await fetchAlerts(askRef.current);
      if (!alive.current || asked !== current.current) return;
      retry.current.failures = 0;
      setFresh(true);
      setList({ state: 'ready', value: { alerts: page.alerts, cursor: page.cursor ?? null, seenAt: page.seenAt ?? null } });
    } catch (error) {
      if (!alive.current || asked !== current.current) return;
      /* What is on screen stays; with nothing read yet, what this person read last time; only then the error. */
      setList((prev) => {
        if (prev.state === 'ready') return prev;
        const kept = KEPT.get(who(), asked);
        return kept === null ? { state: 'failed', error } : { state: 'ready', value: kept };
      });
      retry.current.failures += 1;
      retry.current.timer = setTimeout(() => {
        retry.current.timer = null;
        if (alive.current && asked === current.current) void refresh();
      }, retryDelayMs(retry.current.failures));
    }
  }, [setList]);

  const more = useRef(false);
  const loadMore = useCallback(() => {
    if (more.current || list.state !== 'ready' || list.value.cursor === null) return;
    const asked = current.current;
    const held = list.value;
    more.current = true;
    setLoadingMore(true);
    fetchAlerts(askRef.current, held.cursor)
      .then(
        (page) => {
          if (!alive.current || asked !== current.current) return;
          const ids = new Set(held.alerts.map((a) => a.id));
          setList({ state: 'ready', value: { alerts: [...held.alerts, ...page.alerts.filter((a) => !ids.has(a.id))], cursor: page.cursor ?? null, seenAt: held.seenAt } });
        },
        () => undefined,
      )
      .finally(() => {
        more.current = false;
        if (alive.current) setLoadingMore(false);
      });
  }, [list, setList]);

  useEffect(() => {
    alive.current = true;
    current.current = key;
    retry.current.failures = 0;
    setFresh(false);
    const kept = KEPT.get(who(), key);
    setListState(kept === null ? { state: 'loading' } : { state: 'ready', value: kept });
    void refresh();
    const timers = retry.current;
    return () => {
      alive.current = false;
      if (timers.timer !== null) clearTimeout(timers.timer);
      timers.timer = null;
    };
  }, [key, refresh]);

  return { list, fresh, refresh, loadMore, loadingMore };
}
