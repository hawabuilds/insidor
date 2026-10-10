/**
 * FOR YOU — the feed, and the only screen reading real data.
 *
 * The board comes from `GET /board/default` on the read service (or the dev fixtures standing
 * in for it). The three tabs are three views of that one board (`feed-tabs.ts`); the site
 * pills and the filter panel narrow it (`feed-filters.ts`); the handle and platform badge on
 * each row come from the row's story (`lead-post.ts`, which says why).
 *
 * ★ THE "Sample data" BAR IS NOT THIS SCREEN'S TO TURN OFF. It shows while the build is on
 * fixtures, or while the board's provenance says its stories were seeded or does not say, and
 * it goes away by itself when the read service commits an observed board (`shared/notice.ts`).
 *
 * ★ EVERY EMPTY LIST SAYS WHICH KIND OF EMPTY IT IS. Could not read the board, the board is
 * empty, nothing is starred, the filters matched nothing, or rows were left out because a
 * value the filter needs is unknown — five different sentences, because they call for five
 * different responses and a blank list answers none of them.
 */

import { useEffect, useMemo, useState } from 'react';
import { BOARD_VIEW, USING_FIXTURES, fetchBoard, type BoardRow } from '../../shared/api/index.ts';
import { useLoad, useNow, useWatchlist } from '../../shared/hooks.ts';
import { boardNotice } from '../../shared/notice.ts';
import { PLATFORMS } from '../../shared/platform.ts';
import { hrefFor } from '../../shared/route.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { useComingSoon } from '../../shared/ui/ComingSoon.tsx';
import { FilterIcon, StarIcon } from '../../shared/ui/icons.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { PlatformMark } from '../../shared/ui/PlatformMark.tsx';
import { StoryRow } from '../../shared/ui/StoryRow.tsx';
import { UnderlineTabs } from '../../shared/ui/UnderlineTabs.tsx';
import { FilterPanel } from './FilterPanel.tsx';
import { NO_FILTERS, POSTED_WINDOWS, VIEW_STEPS, applyFilters, isFiltered, type FeedFilters } from './feed-filters.ts';
import { rowsInOrder, tabView, type FeedTab } from './feed-tabs.ts';
import { useLeadPosts } from './useLeadPosts.ts';
import styles from './feed.module.css';

const TABS = [
  { key: 'watchlist', label: <><StarIcon size={16} /> Watchlist</> },
  { key: 'fyp', label: 'FYP' },
  { key: 'popular', label: 'Popular' },
] as const;

export function Feed({ onCreate }: { onCreate: (row: BoardRow, sample: boolean) => void }) {
  const [tab, setTab] = useState<FeedTab>('fyp');
  const [filters, setFilters] = useState<FeedFilters>(NO_FILTERS);
  const [panel, setPanel] = useState(false);
  const [board, reload] = useLoad('board', (signal) => fetchBoard(BOARD_VIEW, signal));
  const starred = useWatchlist();
  const now = useNow();
  const soon = useComingSoon();

  /* Coming back to the app is when somebody expects it to be current. */
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [reload]);

  const tick = board.state === 'ready' ? board.value : null;
  const ordered = useMemo(() => (tick ? rowsInOrder(tick.order, tick.rows) : []), [tick]);
  const view = tabView(tab, ordered, starred);
  const leads = useLeadPosts([...view.rows, ...view.uncounted].map((r) => r.id));
  const shown = applyFilters(view.rows, leads, filters, now);
  const shownUncounted = applyFilters(view.uncounted, leads, filters, now);
  const hidden = shown.unknown + shownUncounted.unknown;

  const notice = boardNotice(USING_FIXTURES, tick?.provenance ?? null);
  const quickSite = filters.sites.length === 1 ? filters.sites[0] : null;
  const row = (r: BoardRow) => {
    const lead = leads.get(r.id) ?? null;
    return (
      <StoryRow
        key={r.id}
        item={r}
        now={now}
        byline={lead !== null ? <span>{lead.author}</span> : null}
        platform={lead?.platform ?? null}
        platformLabel={lead?.sourceLabel ?? ''}
        handlers={{
          open: () => (window.location.hash = hrefFor({ screen: 'story', storyId: r.id, sample: false })),
          viewCoins: () => (window.location.hash = hrefFor({ screen: 'story', storyId: r.id, sample: false })),
          create: () => onCreate(r, notice !== null),
          buy: (ticker) => soon(`Buying $${ticker}`),
        }}
      />
    );
  };

  return (
    <section className={styles['screen']}>
      <header className={styles['header']}>
        <span className={styles['wordmark']}>INSIDOR</span>
      </header>

      <UnderlineTabs tabs={TABS} current={tab} onChange={setTab} label="Feed" />

      <div className={styles['filterRow']}>
        <button
          type="button"
          className={`${styles['filterButton']} ${isFiltered(filters) ? styles['filterOn'] : ''}`}
          aria-label="Filters"
          aria-expanded={panel}
          onClick={() => setPanel((p) => !p)}
        >
          <FilterIcon size={18} />
        </button>
        <div className={styles['quick']}>
          <button
            type="button"
            className={`${styles['quickPill']} ${filters.sites.length === 0 ? styles['quickOn'] : ''}`}
            onClick={() => setFilters((f) => ({ ...f, sites: [] }))}
          >
            All
          </button>
          {PLATFORMS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`${styles['quickPill']} ${filters.sites.includes(p.key) ? styles['quickOn'] : ''}`}
              onClick={() => setFilters((f) => ({ ...f, sites: quickSite === p.key ? [] : [p.key] }))}
            >
              <PlatformMark platform={p.key} size={14} /> {p.label}
            </button>
          ))}
        </div>
        {panel ? (
          <FilterPanel
            applied={filters}
            steps={VIEW_STEPS}
            windows={POSTED_WINDOWS}
            onApply={(f) => {
              setFilters(f);
              setPanel(false);
            }}
            onClose={() => setPanel(false)}
          />
        ) : null}
      </div>

      <Notice notice={notice} />

      {board.state === 'loading' ? <p className={styles['empty']}>Reading the board.</p> : null}
      {board.state === 'failed' ? (
        <div className={styles['empty']}>
          <p>Couldn't reach the read service, so there is nothing to show. This is not an empty board.</p>
          <Button look="quiet" onClick={reload}>Try again</Button>
        </div>
      ) : null}

      {tick !== null ? (
        <>
          {shown.rows.map(row)}
          {shownUncounted.rows.length > 0 ? (
            <>
              <h2 className={styles['group']}>Views not reported</h2>
              {shownUncounted.rows.map(row)}
            </>
          ) : null}
          <EmptyLine
            boardEmpty={ordered.length === 0}
            tab={tab}
            nothingShown={shown.rows.length + shownUncounted.rows.length === 0}
            filtered={isFiltered(filters)}
            starredOffBoard={view.starredOffBoard}
          />
          {hidden > 0 ? (
            <p className={styles['hidden']}>
              {hidden === 1 ? '1 more post is' : `${hidden} more posts are`} left out because we can't tell yet whether{' '}
              {hidden === 1 ? 'it matches' : 'they match'} these filters.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function EmptyLine(p: {
  boardEmpty: boolean;
  tab: FeedTab;
  nothingShown: boolean;
  filtered: boolean;
  starredOffBoard: number;
}) {
  if (p.boardEmpty) return <p className={styles['empty']}>Nothing is on the board right now.</p>;
  const off = p.starredOffBoard;
  const offLine = off > 0 ? ` ${off === 1 ? '1 starred story is' : `${off} starred stories are`} not on the board right now.` : '';
  if (p.tab === 'watchlist' && p.nothingShown && !p.filtered) {
    return <p className={styles['empty']}>Nothing starred here yet. Tap the star on a narrative to keep it in this list.{offLine}</p>;
  }
  if (p.nothingShown) return <p className={styles['empty']}>No posts match these filters.</p>;
  if (offLine !== '') return <p className={styles['hidden']}>{offLine.trim()}</p>;
  return null;
}
