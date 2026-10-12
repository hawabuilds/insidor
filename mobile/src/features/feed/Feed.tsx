/**
 * FOR YOU — the feed.
 *
 * FYP and Popular are feeds of SINGLE POSTS from `GET /rising/fyp` and `GET /rising/popular`:
 * posts the catch-all search found whose meme score clears the bar, newest first and most
 * views first, in the order the server committed. Watchlist is the narratives you starred,
 * read from `GET /board/default` (`feed-tabs.ts`). The site pills and the filter panel narrow
 * whichever list is showing (`feed-filters.ts`).
 *
 * ★ THE "Sample data" BAR IS NOT THIS SCREEN'S TO TURN OFF. It shows only while the server's own
 * provenance says the board's stories were written by hand or does not say, and it goes away by
 * itself when the read service commits an observed board (`shared/notice.ts`). The app has no
 * sample data of its own.
 *
 * ★ EVERY EMPTY LIST SAYS WHICH KIND OF EMPTY IT IS. Could not read the board, the board is
 * empty, nothing is starred, the filters matched nothing, or rows were left out because a
 * value the filter needs is unknown — five different sentences, because they call for five
 * different responses and a blank list answers none of them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BOARD_VIEW, fetchBoard, fetchRising, type BoardRow, type RisingPost } from '../../shared/api/index.ts';
import { useLoad, useNow, useWatchlist } from '../../shared/hooks.ts';
import { boardNotice } from '../../shared/notice.ts';
import { FILTER_PLATFORMS } from '../../shared/platform.ts';
import { hrefFor } from '../../shared/route.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { useComingSoon } from '../../shared/ui/ComingSoon.tsx';
import { FilterIcon, StarIcon } from '../../shared/ui/icons.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { PlatformMark } from '../../shared/ui/PlatformMark.tsx';
import { PostRow } from '../../shared/ui/PostRow.tsx';
import { StoryRow } from '../../shared/ui/StoryRow.tsx';
import { UnderlineTabs } from '../../shared/ui/UnderlineTabs.tsx';
import { FilterPanel } from './FilterPanel.tsx';
import { NO_FILTERS, POSTED_WINDOWS, VIEW_STEPS, applyFilters, applyPostFilters, isFiltered, type FeedFilters } from './feed-filters.ts';
import { rowsInOrder, tabView, type FeedTab } from './feed-tabs.ts';
import { useLeadPosts } from './useLeadPosts.ts';
import styles from './feed.module.css';

const TABS = [
  { key: 'watchlist', label: <><StarIcon size={16} /> Watchlist</> },
  { key: 'fyp', label: 'FYP' },
  { key: 'popular', label: 'Popular' },
] as const;

export function Feed({
  onCreate,
  onCreatePost,
}: {
  onCreate: (row: BoardRow, labelled: boolean) => void;
  /** Create from a single post: its picture and link, never a name we made up. */
  onCreatePost: (post: RisingPost) => void;
}) {
  const [tab, setTab] = useState<FeedTab>('fyp');
  const [filters, setFilters] = useState<FeedFilters>(NO_FILTERS);
  const [panel, setPanel] = useState(false);
  const [board, reloadBoard] = useLoad('board', (signal) => fetchBoard(BOARD_VIEW, signal));
  /* One loader per feed, so switching tabs never shows one feed's order under the other's name. */
  const [fyp, reloadFyp] = useLoad('rising:fyp', (signal) => fetchRising('fyp', signal));
  const [popular, reloadPopular] = useLoad('rising:popular', (signal) => fetchRising('popular', signal));
  const reload = useCallback(() => {
    reloadBoard();
    reloadFyp();
    reloadPopular();
  }, [reloadBoard, reloadFyp, reloadPopular]);
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
  const onPosts = tab !== 'watchlist';
  const view = tabView(tab, ordered, starred);
  /* Lead posts are only read for the narrative list; the post feeds carry their own. */
  const leads = useLeadPosts(onPosts ? [] : [...view.rows, ...view.uncounted].map((r) => r.id));
  const shown = applyFilters(view.rows, leads, filters, now);
  const shownUncounted = applyFilters(view.uncounted, leads, filters, now);
  const hidden = shown.unknown + shownUncounted.unknown;

  const notice = boardNotice(tick?.provenance ?? null);
  const feed = tab === 'popular' ? popular : fyp;
  const posts = feed.state === 'ready' ? applyPostFilters(feed.value.posts, filters, now) : null;
  const post = (p: RisingPost) => (
    <PostRow
      key={p.id}
      post={p}
      now={now}
      handlers={{
        open: () => {
          if (p.storyId !== null) window.location.hash = hrefFor({ screen: 'story', storyId: p.storyId });
          else if (p.permalink !== null) window.open(p.permalink, '_blank', 'noopener');
        },
        /* A post's coin is always its narrative's, so its page opens with the narrative on top. */
        buy: (coin) =>
          (window.location.hash = hrefFor(
            p.storyId !== null ? { screen: 'coin', storyId: p.storyId, coinId: coin.coinId } : { screen: 'token', coinId: coin.coinId },
          )),
        create: () => onCreatePost(p),
        viewCoins: () => {
          if (p.storyId !== null) window.location.hash = hrefFor({ screen: 'story', storyId: p.storyId });
        },
      }}
    />
  );
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
          open: () => (window.location.hash = hrefFor({ screen: 'story', storyId: r.id })),
          viewCoins: () => (window.location.hash = hrefFor({ screen: 'story', storyId: r.id })),
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
          {FILTER_PLATFORMS.map((p) => (
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

      {onPosts ? (
        <>
          {feed.state === 'loading' ? <p className={styles['empty']}>Reading the feed.</p> : null}
          {feed.state === 'failed' ? (
            <div className={styles['empty']}>
              <p>Couldn't reach the read service, so there is nothing to show. This is not an empty feed.</p>
              <Button look="quiet" onClick={reload}>Try again</Button>
            </div>
          ) : null}
          {feed.state === 'ready' && posts !== null ? (
            <>
              {posts.rows.map(post)}
              {feed.value.posts.length === 0 ? <p className={styles['empty']}>No posts yet.</p> : null}
              {feed.value.posts.length > 0 && posts.rows.length === 0 && posts.unknown === 0 ? (
                <p className={styles['empty']}>No posts match these filters.</p>
              ) : null}
              {posts.unknown > 0 ? (
                <p className={styles['hidden']}>
                  {posts.unknown === 1 ? '1 more post is' : `${posts.unknown} more posts are`} left out because we can't tell yet whether{' '}
                  {posts.unknown === 1 ? 'it matches' : 'they match'} these filters.
                </p>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      {!onPosts && board.state === 'loading' ? <p className={styles['empty']}>Reading the board.</p> : null}
      {!onPosts && board.state === 'failed' ? (
        <div className={styles['empty']}>
          <p>Couldn't reach the read service, so there is nothing to show. This is not an empty board.</p>
          <Button look="quiet" onClick={reload}>Try again</Button>
        </div>
      ) : null}

      {!onPosts && tick !== null ? (
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
  if (p.boardEmpty) return <p className={styles['empty']}>No narratives yet.</p>;
  const off = p.starredOffBoard;
  const offLine = off > 0 ? ` ${off === 1 ? '1 starred story is' : `${off} starred stories are`} not on the board right now.` : '';
  if (p.tab === 'watchlist' && p.nothingShown && !p.filtered) {
    return <p className={styles['empty']}>Nothing starred here yet. Tap the star on a narrative to keep it in this list.{offLine}</p>;
  }
  if (p.nothingShown) return <p className={styles['empty']}>No posts match these filters.</p>;
  if (offLine !== '') return <p className={styles['hidden']}>{offLine.trim()}</p>;
  return null;
}
