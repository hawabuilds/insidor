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
 * What breaks if changed carelessly: the first read failing must still say so (the screens say
 * the feed could not be read), never fall through to an empty list that looks like a quiet day.
 * And an answer for an ask no longer on screen is dropped, or switching tabs fast would show one
 * tab's rows under another's name.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchAlerts, type Alert, type AlertListAsk } from '../../shared/api/people.ts';
import type { Load } from '../../shared/hooks.ts';

export type AlertList = { readonly alerts: readonly Alert[]; readonly cursor: string | null; readonly seenAt: number | null };

export function useAlertList(
  ask: AlertListAsk,
  key: string,
): { readonly list: Load<AlertList>; readonly refresh: () => Promise<void>; readonly loadMore: () => void; readonly loadingMore: boolean } {
  const [list, setList] = useState<Load<AlertList>>({ state: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const alive = useRef(true);
  /* The ask on screen now; an answer for any other is dropped. */
  const current = useRef(key);
  const askRef = useRef(ask);
  askRef.current = ask;

  const refresh = useCallback(async () => {
    const asked = current.current;
    try {
      const page = await fetchAlerts(askRef.current);
      if (alive.current && asked === current.current) setList({ state: 'ready', value: { alerts: page.alerts, cursor: page.cursor ?? null, seenAt: page.seenAt ?? null } });
    } catch (error) {
      if (alive.current && asked === current.current) setList((prev) => (prev.state === 'ready' ? prev : { state: 'failed', error }));
    }
  }, []);

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
  }, [list]);

  useEffect(() => {
    alive.current = true;
    current.current = key;
    setList({ state: 'loading' });
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [key, refresh]);

  return { list, refresh, loadMore, loadingMore };
}
