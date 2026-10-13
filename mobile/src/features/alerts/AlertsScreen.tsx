/**
 * THE FEED TAB — Trador's Feed (app/(app)/feed/FeedScreen.tsx), with Insidor's items. Called
 * Alerts until it took Trador's name; its files keep the old name because `features/feed` is the
 * For you screen.
 *
 * Trador's page, piece by piece: a sticky "Feed" title with the bell at its right (the only place
 * the unread count is shown; it opens Notifications), three tabs under the title, the This week /
 * All time toggle on the second, rows with no box, four skeleton rows while loading, a centred
 * sentence when a tab is empty (with "See all time" on an empty week), twenty rows at a time with
 * "Load more" under them, "You have seen everything" at the end, and pull to refresh. Each tab
 * (and each window of Rising) is its own paged list, read from the alert service by itself.
 *
 * Trador's tabs are Following, Top calls and Latest, about people's trades and comments; Insidor
 * has neither, so its tabs are Watching (narratives you starred), Rising (rising posts) and Latest
 * (the whole Feed). It opens on Watching once you star a narrative, as Trador opens on Following
 * once you are signed in, and on Rising before that: an empty tab is a dead end on a first visit.
 *
 * Every row is a fact (a post's views, a narrative's name, a coin matched to it) and opens where
 * it happened. Nothing here marks anything read: that is Notifications', when it opens.
 */

import { useState } from 'react';

import type { Alert } from '../../shared/api/people.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { useNow, useWatchlist } from '../../shared/hooks.ts';
import { Value } from '../../shared/ui/Value.tsx';
import { useAlertList } from './list.ts';
import { Bell, Headline, LoadMore, Mark, PageTabs, PullIndicator, Segmented } from './Parts.tsx';
import { pullStyle, usePullToRefresh } from './pull.ts';
import { feedTab, weekStart, type FeedTab, type FeedWindow } from './split.ts';
import styles from './alerts.module.css';

const TABS: readonly { readonly key: FeedTab; readonly label: string }[] = [
  { key: 'watching', label: 'Watching' },
  { key: 'rising', label: 'Rising' },
  { key: 'latest', label: 'Latest' },
];

const WINDOWS: readonly { readonly key: FeedWindow; readonly label: string }[] = [
  { key: 'week', label: 'This week' },
  { key: 'all', label: 'All time' },
];

/** An alert's link as an in-app hash: the service writes `/#/…`. */
export const linkOf = (href: string): string => (href.startsWith('/') ? href.replace(/^\//, '') || '#/' : '#/');

export function AlertsScreen({ unread, onRefreshed }: { unread: number; onRefreshed: () => void }) {
  const now = useNow();
  const starred = useWatchlist();
  const [tab, setTab] = useState<FeedTab>(starred.length > 0 ? 'watching' : 'rising');
  const [period, setPeriod] = useState<FeedWindow>('week');
  /* Rising's week starts at this morning's midnight minus six days, read when the list is asked for. */
  const ask = tab === 'rising' && period === 'week' ? { list: 'feed' as const, tab, since: weekStart(Date.now()) } : { list: 'feed' as const, tab };
  const { list, refresh, loadMore, loadingMore } = useAlertList(ask, `${tab}:${tab === 'rising' ? period : ''}`);
  const { pull, refreshing } = usePullToRefresh(async () => {
    await refresh();
    onRefreshed();
  });

  const empty =
    tab === 'watching'
      ? 'Star a few narratives and the coins matched to them land here.'
      : tab === 'rising'
        ? period === 'week'
          ? 'No rising posts this week yet.'
          : 'No rising posts yet.'
        : 'Nothing yet. New narratives, their coins and rising posts land here.';

  return (
    <>
      <PullIndicator pull={pull} refreshing={refreshing} />
      <section className={styles['page']} style={pullStyle(pull)}>
        <header className={styles['sticky']}>
          <div className={styles['titleRow']}>
            <h1 className={styles['title']}>Feed</h1>
            <Bell unread={unread} />
          </div>
          <PageTabs tabs={TABS} current={tab} onChange={setTab} label="Feed" />
        </header>

        {tab === 'rising' ? (
          <div className={styles['windowRow']}>
            <Segmented options={WINDOWS} current={period} onChange={setPeriod} />
          </div>
        ) : null}

        {list.state === 'loading' ? <Skeleton /> : null}
        {list.state === 'failed' ? <p className={styles['centred']}>Your feed couldn't be read just now. Pull down to try again.</p> : null}
        {list.state === 'ready' ? (
          <Rows
            items={feedTab(list.value.alerts, tab, { starred, window: period, now })}
            now={now}
            empty={empty}
            more={list.value.cursor !== null ? { onLoad: loadMore, loading: loadingMore } : null}
            {...(tab === 'rising' && period === 'week' ? { emptyAction: { label: 'See all time', onAct: () => setPeriod('all') } } : {})}
          />
        ) : null}
      </section>
    </>
  );
}

function Skeleton() {
  return (
    <ul className={styles['list']} aria-label="Loading">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className={styles['skeletonRow']}>
          <span className={styles['skeletonFace']} />
          <div>
            <span className={styles['skeletonBar']} style={{ width: 112 }} />
            <span className={styles['skeletonBar']} style={{ width: 64, height: 12, marginTop: 8 }} />
            <span className={styles['skeletonBar']} style={{ width: '100%', marginTop: 12 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Rows({ items, now, empty, emptyAction, more }: { items: readonly Alert[]; now: number; empty: string; emptyAction?: { label: string; onAct: () => void }; more: { onLoad: () => void; loading: boolean } | null }) {
  if (items.length === 0 && more === null) {
    return (
      <div className={styles['emptyBox']}>
        <p className={styles['emptyText']}>{empty}</p>
        {emptyAction !== undefined ? (
          <button type="button" className={styles['emptyAction']} onClick={emptyAction.onAct}>
            {emptyAction.label}
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <>
      <ul className={styles['list']}>
        {items.map((a) => (
          <li key={a.id}>
            <a href={linkOf(a.href)} className={styles['feedRow']}>
              <Mark a={a} />
              <div className={styles['feedText']}>
                <div className={styles['feedLine']}>
                  <span className={styles['feedTitle']}>
                    <Headline a={a} />
                  </span>
                  <span className={styles['age']}>
                    <Value r={formatAge({ known: true, at: a.at as never }, now as never)} />
                  </span>
                </div>
                {a.body !== '' ? <p className={styles['feedDetail']}>{a.body}</p> : null}
              </div>
            </a>
          </li>
        ))}
      </ul>
      {more !== null ? <LoadMore onLoad={more.onLoad} loading={more.loading} /> : <p className={styles['end']}>You have seen everything</p>}
    </>
  );
}
