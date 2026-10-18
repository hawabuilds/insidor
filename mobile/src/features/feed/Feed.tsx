/**
 * HOME — posts first, under two tabs: Watchlist and For You (the owner, 2026-10-17: "posts and
 * narratives on separate tabs"). Narratives have their own tab in the bottom bar and are on Home only
 * as the ones you starred, under your watched posts; a post card's narrative tag opens its narrative, and a narrative page lists its posts.
 *
 * For You is a feed of SINGLE POSTS from `GET /rising/fyp`: posts the catch-all search found whose
 * meme score clears the bar, newest first, in the order the server committed. Watchlist is the posts
 * you watch (the star on a card or the post sheet, read from the alert service: useWatchedPosts.ts),
 * then, compact under them, the narratives starred on this phone (the narrative page's star,
 * shared/watchlist.ts) as the Narratives tab draws them (the owner, 2026-10-17: "Starred narratives:
 * watchlist"). Each starred narrative is read by its own id (GET /story/:id), wherever it is — on the
 * board or long dead, the owner 2026-10-18: a starred narrative never drops out — and a merged one
 * opens as the narrative it was merged into. Home stays posts first; a starred id with no page (an
 * old story id from before the rebuild, one the owner said is not a narrative) is left out, never
 * drawn as a broken card.
 * The site pills and the filter panel narrow whichever list is showing (`feed-filters.ts`). The board
 * (`GET /board/default`) is still read, for its provenance alone: the Sample data bar.
 * ★ FOR YOU'S SORT CHIPS (feed-sort.ts, the owner's design of 2026-10-18): New, the default, is the
 * feed as it always was; Trending (right now, no window) and Most viewed (Today or This week) are the
 * read service's lists of For You's own posts in its order (`GET /rising/fyp/sorted`,
 * services/read/src/post-sorts.ts). A Trending card (only posts speeding up) says its views a minute and how many times faster than the hour before; a Most
 * viewed card's big views number is what the list is ordered by. The choice is remembered on this
 * phone. The live slide-ins are New's; a sorted list comes 20 at a time as it is scrolled
 * (useSortedPages.ts), its first page read again every two minutes and on pull to refresh.
 *
 * Pulling the list down from the top reads it again (alerts/pull.ts); For You comes newest first, so
 * new posts land at the top.
 *
 * ★ THE "Sample data" BAR IS NOT THIS SCREEN'S TO TURN OFF. It shows only while the server's own
 * provenance says the board's stories were written by hand or does not say, and it goes away by
 * itself when the read service commits an observed board (`shared/notice.ts`). The app has no
 * sample data of its own.
 *
 * ★ EVERY EMPTY LIST SAYS WHICH KIND OF EMPTY IT IS. Could not read the feed, the feed is empty,
 * nothing is watched, the filters matched nothing, or posts were left out because a value the
 * filter needs is unknown — different sentences, because they call for different responses and a
 * blank list answers none of them.
 *
 * A post card looks as it did before the post sheet was built (shared/ui/PostRow.tsx). Tapping it,
 * its Buy or its View coins opens the post sheet (features/post-sheet); See N coins opens that
 * sheet straight on Choose coin, and Create coin opens the create flow from the post. A tap on the
 * card's coin itself opens that coin's token page (features/token/coin-opening.ts).
 *
 * Under a post's coin line, when the server says so, a line of its own: an older coin named for
 * the post's subject is trading more since it (OlderCoins.tsx) — never the post's coin, never a
 * Buy on the card; tapping opens that coin's page, or the list when there are several.
 *
 * ★ WITHOUT END (the owner, 2026-10-14). For You shows every post that was ever on it:
 * the frame at the top, then older posts read twenty at a time about ten cards before the end
 * (useOlderPosts.ts, older-feed.ts) — no Load more button, no pause. Only the cards near the screen
 * are in the page (shared/ui/WindowList.tsx), so the list stays smooth however long it gets, and
 * placeholder cards show only when the next page is slower than the scroll. Filters, the site pills
 * and the owner's hides apply to the whole list. Pull to refresh starts the pages again.
 *
 * LIVE (off unless the build sets VITE_LIVE_FEED=on; features/feed/live-feed.ts): while FYP is open
 * and on screen, a new post slides in at its posted time (the top, unless it passed late) as soon as
 * the projector commits it, and nothing already on the list moves or disappears until pull to
 * refresh (useLiveFeed.ts, LiveCard.tsx). For You is newest posted first all the way down, frame,
 * pages and slide-ins alike (feed-order.ts).
 *
 * The owner, and only the owner, also gets a strip under each card (features/owner): "Not a meme",
 * which takes the post out of this list at once, and the coin call; "Hidden by me" to bring
 * a hidden post back; and, on For You, "Add a missed post" with its coin's address.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BOARD_VIEW, fetchBoard, fetchRising, fetchRisingSorted, fetchStoryIfAny, type PostSpeeds, type RisingFeed, type RisingPost, type RisingSorted, type Story } from '../../shared/api/index.ts';
import { useLoad, useNow, useWatchlist } from '../../shared/hooks.ts';
import { Card as NarrativeCard } from '../narratives/Narratives.tsx';
import { realNarratives, watchLine } from '../narratives/narrative-order.ts';
import { BuyOpen, SheetToast, type SheetNote } from '../post-sheet/index.ts';
import type { CoinFace } from '../narrative/story-coin.ts';
import { usePreloadCreate } from '../create/preload.ts';
import { boardNotice } from '../../shared/notice.ts';
import { FILTER_PLATFORMS } from '../../shared/platform.ts';
import { hrefFor, parseRoute } from '../../shared/route.ts';
import { sheetCoinRoute } from '../token/coin-opening.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { FilterIcon, StarIcon } from '../../shared/ui/icons.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { PlatformMark } from '../../shared/ui/PlatformMark.tsx';
import { PostRow } from '../../shared/ui/PostRow.tsx';
import { OlderCoinsLine } from './OlderCoins.tsx';
import { UnderlineTabs } from '../../shared/ui/UnderlineTabs.tsx';
import { FilterPanel } from './FilterPanel.tsx';
import { NO_RISERS, SORTS, SPANS, gainedLine, loadChoice, saveChoice, speedLine, windowOf, type SortChoice } from './feed-sort.ts';
import { useSortedPages } from './useSortedPages.ts';

const speedLineOf = (s: PostSpeeds | undefined) => (s === undefined ? null : speedLine(s));
const gainedLineOf = (g: number | undefined, w: string) => (w === 'all' ? null : g === undefined ? null : gainedLine(g, w === 'week' ? 'week' : 'today'));
import { NO_FILTERS, POSTED_WINDOWS, VIEW_STEPS, applyPostFilters, isFiltered, type FeedFilters } from './feed-filters.ts';
import { LIVE_FEED } from './live-feed.ts';
import { LiveCard } from './LiveCard.tsx';
import { useLiveFeed } from './useLiveFeed.ts';
import { newestPosted } from './feed-order.ts';
import { PREFETCH_ROWS, withOlder } from './older-feed.ts';
import { useOlderPosts } from './useOlderPosts.ts';
import { WindowList } from '../../shared/ui/WindowList.tsx';
import { WatchStar } from '../../shared/ui/WatchStar.tsx';
import { useWatchedPosts } from './useWatchedPosts.ts';
import { PostSheet } from '../post-sheet/index.ts';
import { PullIndicator } from '../alerts/Parts.tsx';
import { pullStyle, usePullToRefresh } from '../alerts/pull.ts';
import { HiddenByMe } from '../owner/HiddenByMe.tsx';
import { SecondChance } from '../owner/SecondChance.tsx';
import { AddMissedPostSheet } from '../owner/AddMissedPost.tsx';
import { OwnerCardStrip } from '../owner/OwnerCard.tsx';
import { HideBar } from '../owner/OwnerPost.tsx';
import { useIsOwner, useOwnerState, useSavedCalls } from '../owner/hooks.ts';
import { useSeenOnScreen } from '../owner/useSeen.ts';
import { withoutHidden } from '../owner/owner-store.ts';
import styles from './feed.module.css';

/** A card's height before any is measured, and how far beyond the screen cards are kept drawn. */
const CARD_GUESS_PX = 196;
const DRAWN_BEYOND_PX = 1200;
/** How often a ranked list (Trending, Most viewed) is read again while it is on screen. */
const SORTED_EVERY_MS = 120_000;
/** Placeholder cards under the list while the next page is on its way. */
const PLACEHOLDERS = 3;

const idOf = (p: RisingPost): string => p.id;
/** The rows a feed read holds, for the live list (useLiveFeed.ts). */
const postsOf = (f: RisingFeed): readonly RisingPost[] => f.posts;

type FeedTab = 'watchlist' | 'fyp';

const TABS = [
  { key: 'watchlist', label: <><StarIcon size={16} /> Watchlist</> },
  { key: 'fyp', label: 'For You' },
] as const;

export function Feed({
  onCreatePost,
  onCreateStory,
}: {
  /** Create from a single post: its picture and link, never a name we made up. */
  onCreatePost: (post: RisingPost) => void;
  /** Create from a starred narrative's card (Watchlist), as the Narratives tab's Create does. */
  onCreateStory: (story: Story) => void;
}) {
  const [tab, setTab] = useState<FeedTab>('fyp');
  const [filters, setFilters] = useState<FeedFilters>(NO_FILTERS);
  const [panel, setPanel] = useState(false);
  /* The post whose post sheet is open and the view it opened on, or none. */
  const [sheet, setSheet] = useState<{ readonly id: string; readonly start: 'post' | 'coins' } | null>(null);
  /*
   * ★ `#/post/<id>` (a post notification) IS FOR YOU WITH THAT POST'S SHEET UP. The address is put
   * back to For You at once, in place (no new history entry, no hashchange), and the sheet opens over
   * it — so back and the sheet's close both land on For You, whether the app was closed, in the
   * background or open. Taken on arrival and on every later change of address.
   */
  useEffect(() => {
    const take = () => {
      const r = parseRoute(window.location.hash);
      if (r.screen !== 'post') return;
      history.replaceState(history.state, '', hrefFor({ screen: 'feed' }));
      setTab('fyp');
      setSheet({ id: r.postId, start: 'post' });
    };
    take();
    window.addEventListener('hashchange', take);
    return () => window.removeEventListener('hashchange', take);
  }, []);
  const [board, reloadBoard] = useLoad('board', (signal) => fetchBoard(BOARD_VIEW, signal));
  const [fyp, reloadFyp] = useLoad('rising:fyp', (signal) => fetchRising('fyp', signal));
  /* The sort chip and each sort's window, as this phone last left them (feed-sort.ts). */
  const [choice, setChoice] = useState<SortChoice>(loadChoice);
  const choose = (c: SortChoice) => {
    setChoice(c);
    saveChoice(c);
  };
  const win = windowOf(choice);
  const sortedOn = tab === 'fyp' && choice.sort !== 'new';
  const [sorted, reloadSorted] = useLoad<RisingSorted | null>(sortedOn ? `rising:fyp:${choice.sort}:${win ?? ''}` : 'rising:fyp:new', (signal) =>
    sortedOn && win !== null ? fetchRisingSorted(choice.sort, win, null, signal) : Promise.resolve(null),
  );
  /* The pages under the first, as the person scrolls (useSortedPages.ts). */
  const sortedPages = useSortedPages(`${choice.sort}:${win ?? ''}`, sortedOn && sorted.state === 'ready' ? sorted.value : null);
  useEffect(() => {
    if (!sortedOn) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') reloadSorted();
    }, SORTED_EVERY_MS);
    return () => clearInterval(t);
  }, [sortedOn, reloadSorted]);
  usePreloadCreate(); /* Create coin then opens with the launchpad's rules already read. */
  /* FYP kept current while it is looked at, when the build switches it on; otherwise null and unused. */
  const live = useLiveFeed(LIVE_FEED && tab === 'fyp' && !sortedOn, fyp, reloadFyp, postsOf, true, newestPosted);
  /* For You's older pages, kept while Watchlist is open. They start under the card the list shows
     last and join it newest posted first (feed-order.ts). */
  const lastFyp = useRef<string | null>(null);
  const lastFypShown = useCallback(() => lastFyp.current, []);
  const older = useOlderPosts('fyp', lastFypShown, newestPosted);
  /* The narratives starred on this phone (the narrative page's star, shared/watchlist.ts), each read
     by its own id, only while Watchlist is open and something is starred. */
  const starred = useWatchlist();
  const narrativesOn = tab === 'watchlist' && starred.length > 0;
  const [narratives, reloadNarratives] = useLoad(narrativesOn ? `narratives:starred:${starred.join(' ')}` : 'narratives:off', (signal) =>
    narrativesOn ? starredByIds(starred, signal) : Promise.resolve(null),
  );
  const [buying, setBuying] = useState<CoinFace | null>(null);
  const [note, setNote] = useState<SheetNote | null>(null);
  const reload = useCallback(() => {
    reloadBoard();
    reloadFyp();
    reloadSorted();
    reloadNarratives();
  }, [reloadBoard, reloadFyp, reloadSorted, reloadNarratives]);
  const watchedRows = useWatchedPosts(tab === 'watchlist');
  const now = useNow();
  /* The owner's controls (features/owner): drawn only when the services say this is the owner. */
  const owner = useIsOwner();
  const { hidden: hiddenNow } = useOwnerState();
  const [hiddenList, setHiddenList] = useState(false);
  const [secondChance, setSecondChance] = useState(false);
  const [addMissed, setAddMissed] = useState(false);
  /* The owner's screen (features/owner/useSeen.ts): For You cards in view for two seconds, the owner's sign-in only. */
  const seen = useSeenOnScreen('fyp', owner && tab === 'fyp');

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
     hid stays out (withoutHidden below runs on every read, and the hidden set is kept on the
     device and seeded from the server's list, so a reload does not bring it back either). */
  const settled = useRef<(() => void) | null>(null);
  const shownLoad = sortedOn ? sorted : tab === 'fyp' ? fyp : board;
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
          /* A pull is the one moment the live list takes the server's order and removals, and the
             older pages start again under the new frame. */
          live.rebuildNext();
          older.reset();
          reload();
        }),
      [reload, live.rebuildNext, older.reset],
    ),
  );

  const onPosts = tab === 'fyp';
  const notice = boardNotice(board.state === 'ready' ? board.value.provenance : null);
  const feed = fyp;
  /* A post the owner hid stays out of the list, live or older, until "Is a meme"; the projection
     drops it on its next run, minutes later (features/owner/owner-store.ts). */
  const headPosts = live.rows ?? (fyp.state === 'ready' ? fyp.value.posts : null);
  lastFyp.current = headPosts?.[headPosts.length - 1]?.id ?? null;
  const feedPosts = useMemo(() => (headPosts === null ? null : withOlder(headPosts, older.posts, newestPosted)), [headPosts, older.posts]);
  /* The ranked list in place of the feed while Trending or Most viewed is chosen; New is the feed. */
  const ranked = sortedOn ? sortedPages.list : null;
  const listLoad = sortedOn ? sorted : feed;
  const listPosts = sortedOn ? (ranked?.posts ?? null) : feedPosts;
  const paging = sortedOn ? sortedPages : older;
  const posts = listLoad.state === 'ready' && listPosts !== null ? applyPostFilters(withoutHidden(listPosts, hiddenNow, (p) => p.id), filters, now) : null;
  useSavedCalls('coin_match', posts === null ? [] : posts.rows.map((p) => p.id), owner);
  const liveOn = live.rows !== null && !sortedOn;
  const post = (p: RisingPost) => (
    <PostRow
      key={p.id}
      post={p}
      now={now}
      cardRef={owner && tab === 'fyp' ? seen(p.id) : undefined}
      extra={
        <>
          {/* An older coin trading on the subject since the post: its own line, never a Buy (OlderCoins.tsx). */}
          <OlderCoinsLine post={p} now={now} />
          {owner ? <OwnerCardStrip post={p} /> : null}
        </>
      }
      watch={<WatchStar postId={p.id} />}
      sortLine={ranked === null ? null : ranked.by === 'trending' ? speedLineOf(ranked.speeds.get(p.id)) : gainedLineOf(ranked.gained.get(p.id), ranked.window)}
      handlers={{
        open: () => setSheet({ id: p.id, start: 'post' }),
        create: () => onCreatePost(p),
        seeCoins: () => setSheet({ id: p.id, start: 'coins' }),
        /* The card's own coin is the post's proven one: its page, with the narrative around it when there is one. */
        openCoin: (coinId) => (window.location.hash = hrefFor(sheetCoinRoute({ coinId, proven: true }, p.storyId))),
        /* The narrative the post is part of: its small tag opens the narrative page. */
        openStory: (storyId) => (window.location.hash = hrefFor({ screen: 'story', storyId })),
      }}
    />
  );
  const quickSite = filters.sites.length === 1 ? filters.sites[0] : null;

  return (
    <>
      <PullIndicator pull={pull} refreshing={refreshing} />
      <section className={styles['screen']} style={pullStyle(pull)}>
        <header className={styles['header']}>
          <span className={styles['wordmark']}>INSIDOR</span>
        </header>

        <UnderlineTabs tabs={TABS} current={tab} onChange={setTab} label="Feed" />

        {tab === 'fyp' ? (
          <div className={styles['sortRow']}>
            <div className={styles['sorts']} role="group" aria-label="Sort">
              {SORTS.map((o) => (
                <button key={o.key} type="button" className={`${styles['sortChip']} ${o.key === choice.sort ? styles['sortOn'] : ''}`} aria-pressed={o.key === choice.sort} onClick={() => choose({ ...choice, sort: o.key })}>
                  {o.label}
                </button>
              ))}
            </div>
            {choice.sort === 'most_viewed' ? (
              <div className={styles['windows']} role="group" aria-label="Posted">
                {SPANS.map((s) => (
                  <button key={s.key} type="button" className={s.key === choice.span ? styles['windowOn'] : ''} aria-pressed={s.key === choice.span} onClick={() => choose({ ...choice, span: s.key })}>
                    {s.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

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
            <Button look="quiet" onClick={() => setSecondChance(true)}>Second chances</Button>
            <Button look="quiet" onClick={() => setAddMissed(true)}>Add a missed post</Button>
          </div>
        ) : null}

        {onPosts ? (
          <>
            {listLoad.state === 'loading' ? <p className={styles['empty']}>Reading the feed.</p> : null}
            {listLoad.state === 'failed' ? (
              <div className={styles['empty']}>
                <p>Couldn't reach the read service, so there is nothing to show. This is not an empty feed.</p>
                <Button look="quiet" onClick={reload}>Try again</Button>
              </div>
            ) : null}
            {listLoad.state === 'ready' && posts !== null ? (
              <>
                <WindowList
                  key={sortedOn ? `${choice.sort}:${win ?? ''}` : tab}
                  items={posts.rows}
                  keyOf={idOf}
                  render={(p) =>
                    liveOn ? (
                      <LiveCard id={p.id} arrival={live.arrivals.get(p.id)}>
                        {post(p)}
                      </LiveCard>
                    ) : (
                      post(p)
                    )
                  }
                  guess={CARD_GUESS_PX}
                  overscan={DRAWN_BEYOND_PX}
                  nearEnd={PREFETCH_ROWS}
                  {...(paging !== null ? { onNearEnd: paging.more } : {})}
                />
                {paging?.phase === 'loading' ? <Placeholders /> : null}
                {paging?.phase === 'failed' ? (
                  <div className={styles['empty']}>
                    <p>{sortedOn ? "Couldn't read more of this list. The posts above are everything read so far." : "Couldn't read older posts. The ones above are everything read so far."}</p>
                    <Button look="quiet" onClick={paging.retry}>Try again</Button>
                  </div>
                ) : null}
                {ranked !== null && ranked.posts.length === 0 ? (
                  <p className={styles['empty']}>
                    {ranked.by === 'trending'
                      ? NO_RISERS
                      : ranked.window === 'all'
                        ? 'No For You post has been read yet.'
                        : `No For You post was read ${ranked.window === 'week' ? 'this week' : 'today'}, so there is nothing to show yet.`}
                  </p>
                ) : null}
                {!sortedOn && (feedPosts?.length ?? 0) === 0 && paging.phase === 'done' ? <p className={styles['empty']}>No posts yet.</p> : null}
                {(listPosts?.length ?? 0) > 0 && posts.rows.length === 0 && posts.unknown === 0 && (paging === null || paging.phase === 'done') ? (
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

        {!onPosts ? (
          <>
            <h2 className={styles['group']}>Posts you watch</h2>
            {withoutHidden(watchedRows.rows, hiddenNow, (p) => p.id).map(post)}
            {watchedRows.reading > 0 ? <p className={styles['hidden']}>Reading {watchedRows.reading === 1 ? '1 watched post' : `${watchedRows.reading} watched posts`}.</p> : null}
            {watchedRows.failed > 0 ? <p className={styles['hidden']}>{watchedRows.failed === 1 ? "1 watched post couldn't" : `${watchedRows.failed} watched posts couldn't`} be read just now.</p> : null}
            {watchedRows.state === 'ready' && watchedRows.rows.length + watchedRows.reading + watchedRows.failed === 0 ? (
              <p className={styles['empty']}>No posts watched yet. Tap the star on a post to hear the moment a coin for it launches or is found.</p>
            ) : null}
            {watchedRows.state === 'loading' ? <p className={styles['hidden']}>Reading your watched posts.</p> : null}
            {watchedRows.state === 'failed' ? <p className={styles['hidden']}>Your watched posts couldn't be read just now.</p> : null}
            <StarredNarratives starred={starred} list={narratives.state === 'ready' ? (narratives.value?.stories ?? null) : null} failed={narratives.state === 'failed'} now={now} onBuy={setBuying} onCreate={onCreateStory} />
          </>
        ) : null}
        {buying !== null ? <BuyOpen mint={buying.address} ticker={buying.ticker ?? buying.name ?? ''} onClose={() => setBuying(null)} onNote={setNote} /> : null}
        <SheetToast note={note} onDone={() => setNote(null)} />

        {hiddenList ? <HiddenByMe onClose={() => setHiddenList(false)} /> : null}
        {owner && secondChance ? <SecondChance onClose={() => setSecondChance(false)} /> : null}
        {owner && addMissed ? <AddMissedPostSheet onClose={() => setAddMissed(false)} /> : null}
        {owner ? <HideBar /> : null}
        {sheet !== null ? <PostSheet key={sheet.id} postId={sheet.id} start={sheet.start} onClose={() => setSheet(null)} /> : null}
      </section>
    </>
  );
}

/**
 * Each starred narrative's page by its id, in starred order, at most one card per narrative (a
 * merged id opens the one it was merged into, which may be starred too). A page that is not there
 * (404) is left out; any other failure fails the whole read, so the screen says it could not read
 * them rather than showing fewer than were starred.
 */
async function starredByIds(ids: readonly string[], signal: AbortSignal): Promise<{ readonly stories: readonly Story[] }> {
  const got = await Promise.all(ids.map((id) => fetchStoryIfAny(id, signal)));
  const seen = new Set<string>();
  return { stories: got.filter((s): s is Story => s !== null && !seen.has(s.id) && (seen.add(s.id), true)) };
}

/** Card-shaped placeholders under the list while the next page is on its way: only ever seen when the page is slower than the scroll. */
/**
 * The narratives starred on this phone, under the watched posts: the Narratives tab's card with no
 * place, "N posts  X views" and the last hour's gain. Nothing is drawn — no heading either — when
 * none of the starred ids has a page (an old story id starred before the rebuild, or one the owner
 * said is not a narrative): a starred id never becomes an empty or broken card.
 */
function StarredNarratives({ starred, list, failed, now, onBuy, onCreate }: {
  starred: readonly string[];
  list: readonly Story[] | null;
  failed: boolean;
  now: number;
  onBuy: (c: CoinFace) => void;
  onCreate: (s: Story) => void;
}) {
  if (starred.length === 0) return null;
  if (failed) return <p className={styles['hidden']}>Your starred narratives couldn't be read just now.</p>;
  const shown = list === null ? [] : realNarratives(list);
  if (shown.length === 0) return null;
  return (
    <>
      <h2 className={styles['group']}>Narratives you starred</h2>
      <div className={styles['narratives']}>
        {shown.map((s) => (
          <NarrativeCard
            key={s.id}
            story={s}
            place={null}
            hours={1}
            now={now}
            line={watchLine(s)}
            onOpen={() => (window.location.hash = hrefFor({ screen: 'story', storyId: s.id }))}
            onBuy={onBuy}
            onCreate={() => onCreate(s)}
          />
        ))}
      </div>
    </>
  );
}

function Placeholders() {
  return (
    <div aria-label="Reading older posts" role="status">
      {Array.from({ length: PLACEHOLDERS }, (_, i) => (
        <div key={i} className={styles['placeholder']} aria-hidden="true">
          <span className={styles['placeholderPic']} />
          <span className={styles['placeholderLines']}>
            <span />
            <span />
            <span />
          </span>
        </div>
      ))}
    </div>
  );
}
