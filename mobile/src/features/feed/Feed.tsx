/**
 * FOR YOU — the feed.
 *
 * FYP and Popular are feeds of SINGLE POSTS from `GET /rising/fyp` and `GET /rising/popular`:
 * posts the catch-all search found whose meme score clears the bar, newest first and most
 * views first, in the order the server committed. Watchlist is the narratives you starred,
 * read from `GET /board/default` (`feed-tabs.ts`). The site pills and the filter panel narrow
 * whichever list is showing (`feed-filters.ts`).
 * Pulling the list down from the top reads it again (alerts/pull.ts); For You comes newest first, so
 * new posts land at the top.
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
 *
 * A post card looks as it did before the post sheet was built (shared/ui/PostRow.tsx). Tapping it,
 * its Buy or its View coins opens the post sheet (features/post-sheet); See N coins opens that
 * sheet straight on Choose coin, and Create coin opens the create flow from the post.
 *
 * Under a post's coin line, when the server says so, a line of its own: an older coin named for
 * the post's subject is trading more since it (OlderCoins.tsx) — never the post's coin, never a
 * Buy on the card; tapping opens that coin's page, or the list when there are several.
 *
 * The owner, and only the owner, also gets a strip under each card (features/owner): "Not a meme",
 * which takes the post out of this list at once, and the coin call; and "Hidden by me" to bring
 * a hidden post back.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BOARD_VIEW, fetchBoard, fetchRising, type BoardRow, type RisingPost } from '../../shared/api/index.ts';
import { useLoad, useNow, useWatchlist } from '../../shared/hooks.ts';
import { usePreloadCreate } from '../create/preload.ts';
import { boardNotice } from '../../shared/notice.ts';
import { FILTER_PLATFORMS } from '../../shared/platform.ts';
import { hrefFor } from '../../shared/route.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { useComingSoon } from '../../shared/ui/ComingSoon.tsx';
import { FilterIcon, StarIcon } from '../../shared/ui/icons.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { PlatformMark } from '../../shared/ui/PlatformMark.tsx';
import { PostRow } from '../../shared/ui/PostRow.tsx';
import { OlderCoinsLine } from './OlderCoins.tsx';
import { StoryRow } from '../../shared/ui/StoryRow.tsx';
import { UnderlineTabs } from '../../shared/ui/UnderlineTabs.tsx';
import { FilterPanel } from './FilterPanel.tsx';
import { NO_FILTERS, POSTED_WINDOWS, VIEW_STEPS, applyFilters, applyPostFilters, isFiltered, type FeedFilters } from './feed-filters.ts';
import { rowsInOrder, tabView, type FeedTab } from './feed-tabs.ts';
import { useLeadPosts } from './useLeadPosts.ts';
import { PostSheet } from '../post-sheet/index.ts';
import { PullIndicator } from '../alerts/Parts.tsx';
import { pullStyle, usePullToRefresh } from '../alerts/pull.ts';
import { HiddenByMe } from '../owner/HiddenByMe.tsx';
import { OwnerCardStrip } from '../owner/OwnerCard.tsx';
import { HideBar } from '../owner/OwnerPost.tsx';
import { useIsOwner, useOwnerState, useSavedCalls } from '../owner/hooks.ts';
import { withoutHidden } from '../owner/owner-store.ts';
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
  /* The post whose post sheet is open and the view it opened on, or none. */
  const [sheet, setSheet] = useState<{ readonly id: string; readonly start: 'post' | 'coins' } | null>(null);
  const [board, reloadBoard] = useLoad('board', (signal) => fetchBoard(BOARD_VIEW, signal));
  /* One loader per feed, so switching tabs never shows one feed's order under the other's name. */
  const [fyp, reloadFyp] = useLoad('rising:fyp', (signal) => fetchRising('fyp', signal));
  const [popular, reloadPopular] = useLoad('rising:popular', (signal) => fetchRising('popular', signal));
  usePreloadCreate(); /* Create coin then opens with the launchpad's rules already read. */
  const reload = useCallback(() => {
    reloadBoard();
    reloadFyp();
    reloadPopular();
  }, [reloadBoard, reloadFyp, reloadPopular]);
  const starred = useWatchlist();
  const now = useNow();
  const soon = useComingSoon();
  /* The owner's controls (features/owner): drawn only when the services say this is the owner. */
  const owner = useIsOwner();
  const { hidden: hiddenNow } = useOwnerState();
  const [hiddenList, setHiddenList] = useState(false);

  /* Coming back to the app is when somebody expects it to be current. */
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [reload]);

  /* Pull to refresh: everything is read again, and the spinner stops when this tab's list is back.
     For You comes newest first from the server, so new posts arrive at the top; a post the owner
     hid stays out (withoutHidden below runs on every read). */
  const settled = useRef<(() => void) | null>(null);
  const shownLoad = tab === 'popular' ? popular : tab === 'fyp' ? fyp : board;
  useEffect(() => {
    if (shownLoad.state !== 'loading') {
      settled.current?.();
      settled.current = null;
    }
  }, [shownLoad]);
  const { pull, refreshing } = usePullToRefresh(
    useCallback(
      () =>
        new Promise<void>((done) => {
          settled.current = done;
          reload();
        }),
      [reload],
    ),
  );

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
  /* A post the owner just hid leaves the list now; the projection drops it on its next run. */
  const posts = feed.state === 'ready' ? applyPostFilters(withoutHidden(feed.value.posts, hiddenNow, (p) => p.id), filters, now) : null;
  useSavedCalls('coin_match', posts === null ? [] : posts.rows.map((p) => p.id), owner);
  const post = (p: RisingPost) => (
    <PostRow
      key={p.id}
      post={p}
      now={now}
      extra={
        <>
          {/* An older coin trading on the subject since the post: its own line, never a Buy (OlderCoins.tsx). */}
          <OlderCoinsLine post={p} now={now} />
          {owner ? <OwnerCardStrip post={p} /> : null}
        </>
      }
      handlers={{
        open: () => setSheet({ id: p.id, start: 'post' }),
        create: () => onCreatePost(p),
        seeCoins: () => setSheet({ id: p.id, start: 'coins' }),
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
    <>
      <PullIndicator pull={pull} refreshing={refreshing} />
      <section className={styles['screen']} style={pullStyle(pull)}>
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

        {owner && onPosts ? (
          <div className={styles['ownerRow']}>
            <Button look="quiet" onClick={() => setHiddenList(true)}>Hidden by me</Button>
          </div>
        ) : null}

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
        {hiddenList ? <HiddenByMe onClose={() => setHiddenList(false)} /> : null}
        {owner ? <HideBar /> : null}
        {sheet !== null ? <PostSheet key={sheet.id} postId={sheet.id} start={sheet.start} onClose={() => setSheet(null)} /> : null}
      </section>
    </>
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
