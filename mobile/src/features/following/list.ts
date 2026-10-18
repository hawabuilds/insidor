/**
 * THE FEED OF PEOPLE'S READ, A PAGE AT A TIME: one tab's list (Following or Latest) with its three
 * honest states, the cursor for the next page, a refresh that resolves when the first page is read
 * again (pull to refresh waits on it), and a read again whenever the tab comes back on screen or
 * the app comes back to the front. `on` false reads nothing (the Latest under People to follow,
 * while it is not shown).
 *
 * Trador's paging (hooks/useSocialFeed.ts): twenty, then Load more with the last page's cursor,
 * until the cursor is null. There is no live line for people's activity, so new trades and
 * comments arrive on focus and on a pull, as the owner agreed; nothing polls.
 *
 * ★ THE LAST ANSWER IS SHOWN AT ONCE, FROM MEMORY ONLY. A kept first page (shared/kept-reads.ts,
 * `phone: false`) opens the tab instantly while the fresh read runs, as every tab does. It is
 * never written to the phone's storage: who you follow and what they did is yours, and the phone
 * store is for the public first screens only. The key carries the signed-in account, so a second
 * person signing in on the same visit never sees the first one's list.
 *
 * What breaks if changed carelessly: a failed first read must say so, never fall through to an
 * empty list that looks like nobody did anything; and an answer for a tab no longer on screen is
 * dropped, or switching tabs fast would show one tab's rows under the other's name.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchPeopleFeed, type FeedPage, type FeedTab } from '../../shared/api/following.ts';
import type { Load } from '../../shared/hooks.ts';
import { keep, kept } from '../../shared/kept-reads.ts';
import { useScreenActive } from '../../shared/screen-active.ts';
import { mergePage } from './lines.ts';

export function usePeopleFeed(tab: FeedTab, account: string, on = true): { readonly list: Load<FeedPage>; readonly refresh: () => Promise<void>; readonly loadMore: () => void; readonly loadingMore: boolean } {
  const key = `people-feed:${account}:${tab}`;
  const initial = (): Load<FeedPage> => {
    const held = kept<FeedPage>(key);
    return held !== undefined ? { state: 'ready', value: held.value, stale: true } : { state: 'loading' };
  };
  const [list, setList] = useState<Load<FeedPage>>(initial);
  const [loadingMore, setLoadingMore] = useState(false);
  const alive = useRef(true);
  const current = useRef(key);
  const active = useScreenActive();

  const refresh = useCallback(async () => {
    const asked = current.current;
    const tabAsked = tab;
    try {
      const page = await fetchPeopleFeed(tabAsked);
      keep(asked, page, false);
      if (alive.current && asked === current.current) setList({ state: 'ready', value: page });
    } catch (error) {
      if (alive.current && asked === current.current) setList((prev) => (prev.state === 'ready' ? prev : { state: 'failed', error }));
    }
  }, [tab]);

  const more = useRef(false);
  const loadMore = useCallback(() => {
    if (more.current || list.state !== 'ready' || list.value.cursor === null) return;
    const asked = current.current;
    const held = list.value;
    more.current = true;
    setLoadingMore(true);
    fetchPeopleFeed(tab, held.cursor)
      .then(
        (page) => {
          if (alive.current && asked === current.current) setList({ state: 'ready', value: { ...page, items: mergePage(held.items, page.items) } });
        },
        () => undefined,
      )
      .finally(() => {
        more.current = false;
        if (alive.current) setLoadingMore(false);
      });
  }, [list, tab]);

  /* A new tab or a new person: its own list, from what was kept for it, then read fresh. */
  useEffect(() => {
    alive.current = true;
    current.current = key;
    setList(initial());
    return () => {
      alive.current = false;
    };
  }, [key]);

  /* Read again when the tab is on screen: on opening, on coming back to it, and on the app coming to the front. */
  useEffect(() => {
    if (!active || !on) return;
    void refresh();
    const onShow = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [active, on, refresh, key]);

  return { list, refresh, loadMore, loadingMore };
}
