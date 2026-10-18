/**
 * THE NARRATIVE PAGE — one narrative on one phone screen, as the owner drew it (2026-10-17):
 *
 *   Top      back, the watch star, and Edit for the owner's wallet only (NarrativeEdit.tsx)
 *   Head     picture and title; "61 posts since Thu   4.2M views"
 *   Facts    ONE line under the head, following the chart's interval (15m on All): "Last 15m +420K
 *            MC +12%   Found 58m before $GTA". Real numbers only, no scores, no opinions
 *   Chart    views gained per interval across all its posts (GainChart.tsx), 5m 15m 1h 4h 1D and
 *            All — the whole story from its first post, the page's first view — with We found it
 *            and the coin's launch at their exact times wherever they fall inside the span; hidden,
 *            not the page, when there is no history
 *   Posts    THE WHOLE STORY (posts-order.ts): the page's two moments, "First post: Thu 09:12" (the
 *            earliest post we know of, even if we found it later) and "We found it: Fri 14:03" (the
 *            earliest save of any post listed), the first post pinned under them, then every other
 *            post, newest first,
 *            twenty at a time as the list's end comes into view. Each row: thumbnail with its site's
 *            badge, one line of text, handle and age, views and the last hour's gain; a tap opens
 *            the post sheet (or the post where it lives)
 *   Coin bar above the tab bar where the token page's Buy and Sell sit: the coin line's three
 *            states (story-coin.ts); Buy opens the existing Buy pop-up, a tap on the bar opens the
 *            token page, "All N coins" opens Choose coin
 *
 * ★ THE NUMBERS ARE THE PROJECTOR'S (core narrativeReach): the total is each post's newest count,
 * the line and "Last 15m" the posts' gains added up five minutes at a time, so the end label and
 * the fact line are one number. "12 of 14 posts counted" when some posts have no reading at all.
 * ★ THE TIMES ARE THE PROOF (gain-chart.ts): We found it is the earliest save of any post listed
 * now; the launch is printed only from the create transaction's block time (the server sends no
 * other clock as known); "Found Xm before $COIN" only when our find is before that block, "Coin was
 * Xm before we found it" when it is not, and nothing when either time is not known.
 *
 * What breaks if changed carelessly: the page reads two replies, the story and its sheet, and the
 * cards of each further screenful of a long story by id (`fetchStoryPosts`). The story alone draws
 * the page and lists every post; a sheet failing costs the coin's market details and the post sheets
 * for the posts it would have carried, never the page or a row.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { Evidence, RisingPost, SheetCoin, Story, StorySheet } from '../../shared/api/index.ts';
import { fetchStoryPosts, fetchStorySheet } from '../../shared/api/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { compact, formatUsd } from '../../shared/format/number.ts';
import { tickerText } from '../../shared/format/ticker.ts';
import { useLoad, useNow, useWatchlist } from '../../shared/hooks.ts';
import { goBack } from '../../shared/nav.ts';
import { platformOf } from '../../shared/platform.ts';
import { hrefFor } from '../../shared/route.ts';
import { loadStory, noticeFor } from '../../shared/story-source.ts';
import { useCoinCap } from '../../shared/useCoinCap.ts';
import { watchlist } from '../../shared/watchlist.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { BackIcon, StarIcon } from '../../shared/ui/icons.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { Sheet } from '../../shared/ui/Sheet.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { useIsOwner } from '../owner/hooks.ts';
import { useSeenOnScreen } from '../owner/useSeen.ts';
import { BuyOpen, CHART_INTERVALS, ChooseCoin, GainChart, PostSheet, SheetToast, firstWords, hm, launchTime, lastGain, plus, useMcChange, LAST_WORDS, pctText, type ChartInterval, type ChartMarker, type GainInterval, type SheetNote } from '../post-sheet/index.ts';
import { sheetCoinRoute } from '../token/coin-opening.ts';
import { NarrativeEdit } from './NarrativeEdit.tsx';
import { PAGE, firstPosted, moments, newestFirst, type Moment } from './posts-order.ts';
import { storyCoinState, type CoinFace, type StoryCoinState } from './story-coin.ts';
import styles from './narrative.module.css';

/** The chart opens on the whole story (the owner's design, 2026-10-17). */
const FIRST_INTERVAL: ChartInterval = 'All';
/** The fact line's interval on All: the chart's whole span has no "last" to speak of. */
const ALL_FACTS: GainInterval = '15m';
/** The plot's own height, in px: what is left of a 390x844 screen with the head, posts' top and the coin bar. */
const PLOT_HEIGHT = 150;

export function NarrativePage({ storyId, onCreate }: {
  storyId: string;
  onCreate: (story: Story) => void;
}) {
  const [story] = useLoad(storyId, (signal) => loadStory(storyId, signal));
  const [sheet] = useLoad(`story-sheet:${storyId}`, (signal) => fetchStorySheet(storyId, signal));
  const [editing, setEditing] = useState(false);
  const owner = useIsOwner();
  const ready = story.state === 'ready' ? story.value : null;
  const read = sheet.state === 'ready' ? sheet.value : null;
  return (
    <section className={styles['page']}>
      <TopBar storyId={storyId} onEdit={owner && ready !== null ? () => setEditing(true) : null} />
      {story.state === 'loading' ? <p className={styles['empty']}>Loading.</p> : null}
      {story.state === 'failed' ? <p className={styles['empty']}>This narrative couldn't be read. It may not be on the read service.</p> : null}
      {ready !== null ? <Body story={ready} sheet={read} onCreate={onCreate} /> : null}
      {editing && ready !== null ? <NarrativeEdit story={ready} sheet={read} onClose={() => setEditing(false)} /> : null}
    </section>
  );
}

function TopBar({ storyId, onEdit }: { storyId: string; onEdit: (() => void) | null }) {
  const starred = useWatchlist().includes(storyId);
  return (
    <div className={styles['top']}>
      <button type="button" className={styles['back']} aria-label="Back" onClick={() => goBack({ screen: 'narratives' })}>
        <BackIcon size={24} />
      </button>
      <div className={styles['topRight']}>
        <button
          type="button"
          className={`${styles['star']} ${starred ? styles['starred'] : ''}`}
          aria-label={starred ? 'Stop watching' : 'Watch'}
          aria-pressed={starred}
          onClick={() => watchlist.toggle(storyId)}
        >
          <StarIcon size={22} filled={starred} />
        </button>
        {onEdit !== null ? <button type="button" className={styles['edit']} onClick={onEdit}>Edit</button> : null}
      </div>
    </div>
  );
}

/** "since 13:20" today, "since Thu" on another day: when its first post went up. */
function sinceText(at: number, now: number): string {
  const d = new Date(at);
  return new Date(now).toDateString() === d.toDateString() ? `since ${hm(at, now)}` : `since ${d.toLocaleDateString('en-GB', { weekday: 'short' })}`;
}

function Body({ story, sheet, onCreate }: { story: Story; sheet: StorySheet | null; onCreate: (s: Story) => void }) {
  const now = useNow();
  const [interval, setIntervalPick] = useState<ChartInterval>(FIRST_INTERVAL);
  const factsAt: GainInterval = interval === 'All' ? ALL_FACTS : interval;
  const [open, setOpen] = useState<string | null>(null);
  const [buying, setBuying] = useState<CoinFace | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [note, setNote] = useState<SheetNote | null>(null);

  const posts = story.postCount ?? story.evidence.length;
  const slots = story.viewsGained;
  const hasHistory = slots !== null && slots.values.some((v) => v !== null);
  const gain = lastGain(slots, factsAt);
  const coin = storyCoinState(story, sheet);
  const checked = coin.kind === 'checked' ? coin.coin : null;
  const mc = useMcChange(checked?.address ?? null, factsAt);
  const ticker = checked !== null ? tickerText(checked.ticker ?? checked.name ?? checked.address.slice(0, 4)) : '';
  const launch = checked === null ? null : launchTime(checked.sheet?.launchedAt.known === true ? checked.sheet.launchedAt.at : null, checked.sheet?.launchClock ?? { kind: 'unknown' }, now);
  const foundAt = story.foundAt?.known === true ? story.foundAt.at : null;
  const first = firstWords(foundAt, launch ?? { kind: 'unknown' }, ticker);
  const firstPost = useMemo(() => {
    const t = story.evidence.flatMap((e) => (e.postedAt.known ? [e.postedAt.at] : []));
    return t.length === 0 ? null : Math.min(...t);
  }, [story.evidence]);
  const total = story.viewsTotal;
  const counted = story.viewsTotalPosts !== null && story.viewsTotalPosts !== posts ? `${story.viewsTotalPosts} of ${posts} posts counted` : null;

  const markers: ChartMarker[] = [
    ...(foundAt !== null ? [{ key: 'found', tone: 'found' as const, text: `We found it ${hm(foundAt, now)}`, at: foundAt }] : []),
    ...(launch === null ? [] : launch.kind === 'at'
      ? [{ key: 'coin', tone: 'coin' as const, text: `${ticker} launched ${launch.text}`, at: launch.at }]
      : [{ key: 'coin', tone: 'coin' as const, text: `${ticker} launch time not known`, at: null }]),
  ];

  const openCoin = (c: CoinFace) => (window.location.hash = hrefFor(sheetCoinRoute(c.sheet ?? { coinId: `solana:${c.address}`, proven: coin.kind === 'checked' }, story.id)));
  const pinned = useMemo(() => firstPosted(story), [story]);
  const when = useMemo(() => moments(story), [story]);
  const momentText = (m: Moment) => (m.known ? hm(m.at, now) : `— ${m.why}`);
  const rest = useMemo(() => newestFirst(story, pinned?.post.evidenceId ?? null), [story, pinned]);
  const [shownCount, setShownCount] = useState(PAGE);
  const visible = rest.slice(0, shownCount);
  const cards = useCards(story.id, sheet, [...(pinned === null ? [] : [pinned.post]), ...visible]);
  const end = useEndInView(() => setShownCount((n) => (n < rest.length ? n + PAGE : n)));
  /* The owner's screen (features/owner/useSeen.ts): this page's posts in view for two seconds, the owner's sign-in only. */
  const owner = useIsOwner();
  const seen = useSeenOnScreen('narrative', owner);
  const row = (e: Evidence) => (
    <PostRow key={e.evidenceId} e={e} story={story} card={cards.get(e.evidenceId)} now={now} onOpen={setOpen} rowRef={owner ? seen(e.evidenceId) : undefined} />
  );

  return (
    <>
      <header className={styles['head']}>
        <Thumb url={story.thumbUrl} size={52} radius={14} />
        <div className={styles['headText']}>
          <h1>{story.title}</h1>
          <span className={styles['meta']}>
            <span>{posts === 1 ? '1 post' : `${posts} posts`}{firstPost !== null ? ` ${sinceText(firstPost, now)}` : ''}</span>
            <span>{total !== null && total.known ? `${compact(total.amount)} views` : '— views'}</span>
          </span>
        </div>
      </header>
      {total === null || !total.known ? <p className={styles['why']}>{total === null ? 'Total views are not read for this narrative yet' : 'No post has a view reading yet'}</p> : counted !== null ? <p className={styles['why']}>{counted}</p> : null}

      <p className={styles['facts']}>
        {hasHistory ? (
          <span>
            {LAST_WORDS[factsAt]} {gain !== null ? <b className={gain > 0 ? styles['up'] : styles['plain']}>{plus(gain)}</b> : 'not read'}
          </span>
        ) : null}
        {checked !== null && mc !== null ? (
          <span>
            MC <b className={mc >= 0 ? styles['up'] : styles['down']}>{pctText(mc)}</b>
          </span>
        ) : null}
        {first !== null ? (
          <span>
            {first.lead} <b className={styles['plain']}>{first.gap}</b> {first.tail}
          </span>
        ) : null}
      </p>

      {hasHistory && slots !== null ? (
        <div className={styles['chartBox']}>
          <GainChart slots={slots} allSlots={story.viewsGainedAll} intervals={CHART_INTERVALS} firstAt={firstPost} firstWord="first post" now={now} interval={interval} onInterval={setIntervalPick} markers={markers} height={PLOT_HEIGHT} />
        </div>
      ) : null}

      <Notice notice={noticeFor(story)} />

      {story.evidence.length > 0 ? (
        <div className={styles['firstCard']}>
          <span className={styles['firstTimes']}>
            <span>First post: <b>{momentText(when.firstPost)}</b></span>
            <span>We found it: <b>{momentText(when.found)}</b></span>
          </span>
          {pinned !== null ? <div className={styles['posts']}>{row(pinned.post)}</div> : null}
        </div>
      ) : null}

      <div className={styles['postsHead']}>
        <h2>{pinned !== null ? 'All posts' : 'Posts'}</h2>
        <span>Newest first</span>
      </div>
      <div className={styles['posts']}>
        {visible.map(row)}
        {visible.length < rest.length ? <div ref={end} className={styles['more']}>Loading more posts</div> : null}
      </div>

      <CoinBar state={coin} coins={sheet?.coins.length ?? 0} onBuy={setBuying} onOpen={openCoin} onAll={() => setChoosing(true)} onCreate={() => onCreate(story)} />

      {open !== null ? <PostSheet postId={open} onClose={() => setOpen(null)} /> : null}
      {choosing && sheet !== null ? (
        <Sheet label="Choose coin" onClose={() => setChoosing(false)}>
          <ChooseCoin data={{ coins: sheet.coins, coinName: story.title, sourcesMissing: sheet.sourcesMissing }} onBack={() => setChoosing(false)} onOpenCoin={(c: SheetCoin) => openCoin({ address: c.address, ticker: c.ticker, name: c.name, imageUrl: c.imageUrl, marketCapUsd: c.marketCapUsd, changePct: c.changePct24h, sheet: c })} onCreate={() => onCreate(story)} onNote={setNote} />
        </Sheet>
      ) : null}
      {buying !== null ? <BuyOpen mint={buying.address} ticker={buying.ticker ?? buying.name ?? ''} onClose={() => setBuying(null)} onNote={setNote} /> : null}
      <SheetToast note={note} onDone={() => setNote(null)} />
    </>
  );
}

/** One post row: thumbnail with its site's badge, a line of text, handle and age, views and the last hour. */
function PostRow({ e, story, card, now, onOpen, rowRef }: { e: Evidence; story: Story; card: RisingPost | undefined; now: number; onOpen: (id: string) => void; rowRef?: ((el: Element | null) => void) | undefined }) {
  const platform = platformOf(e.sourceLabel);
  const pv = story.postViews?.get(e.evidenceId) ?? null;
  const views = pv?.views ?? (card !== undefined && card.reach.known ? card.reach.amount : null);
  const age = formatAge(e.postedAt, now);
  const tap = () => {
    if (card !== undefined) onOpen(card.id);
    else window.open(e.permalink, '_blank', 'noopener');
  };
  return (
    <button type="button" className={styles['row']} onClick={tap} ref={rowRef}>
      <Thumb url={e.thumbUrl ?? card?.thumbUrl ?? null} size={46} radius={12} platform={platform} platformLabel={e.sourceLabel} />
      <span className={styles['rowText']}>
        <span className={styles['rowLine']}>{e.excerpt}</span>
        <span className={styles['rowBy']}>
          {e.authorLabel}
          {age.kind === 'value' ? ` ${age.text}` : ''}
        </span>
      </span>
      <span className={styles['rowNums']}>
        <b>{views !== null ? compact(views) : '—'}</b>
        {pv !== null && pv.gainedLastHour !== null && pv.gainedLastHour > 0 ? <span className={styles['up']}>{plus(pv.gainedLastHour)}</span> : null}
      </span>
    </button>
  );
}

/**
 * The feed cards of the rows on screen: the sheet's, and for the rows past it, asked for by id a
 * screenful at a time (`fetchStoryPosts`). A row whose card never comes opens its post where it lives.
 */
function useCards(storyId: string, sheet: StorySheet | null, rows: readonly Evidence[]): ReadonlyMap<string, RisingPost> {
  const [more, setMore] = useState<ReadonlyMap<string, RisingPost>>(new Map());
  const asked = useRef(new Set<string>());
  const fromSheet = useMemo(() => new Map((sheet?.members ?? []).flatMap((m) => (m.post === null ? [] : [[m.id, m.post] as const]))), [sheet]);
  const carried = useMemo(() => new Set((sheet?.members ?? []).map((m) => m.id)), [sheet]);
  const want = sheet === null ? [] : rows.map((e) => e.evidenceId).filter((id) => !carried.has(id) && !asked.current.has(id));
  const key = want.join(',');
  useEffect(() => {
    if (want.length === 0) return;
    const ask = want.slice(0, 60);
    for (const id of ask) asked.current.add(id);
    /* Not aborted when the ids change: marking them asked changes them, and the answer is still wanted. */
    fetchStoryPosts(storyId, ask)
      .then((ms) => setMore((m) => new Map([...m, ...ms.flatMap((x) => (x.post === null ? [] : [[x.id, x.post] as const]))])))
      .catch(() => undefined);
    /* Keyed on the ids asked for, not the array: a new array of the same ids asks nothing new. */
  }, [storyId, key]);
  return useMemo(() => new Map([...fromSheet, ...more]), [fromSheet, more]);
}

/** A ref for the list's end: `onEnd` each time it comes into view (the next screenful). */
function useEndInView(onEnd: () => void): (el: HTMLDivElement | null) => void {
  const latest = useRef(onEnd);
  latest.current = onEnd;
  const seen = useRef<IntersectionObserver | null>(null);
  return (el) => {
    seen.current?.disconnect();
    seen.current = null;
    if (el === null || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) latest.current();
    }, { rootMargin: '400px 0px' });
    io.observe(el);
    seen.current = io;
  };
}

/**
 * The coin bar, where the token page's Buy and Sell panel sits: logo, ticker and the day's move,
 * "MC   All N coins" (or "Top coin, not checked"), and Buy; "No coin yet" with Create; or the
 * narrative's own line with no button.
 */
function CoinBar({ state, coins, onBuy, onOpen, onAll, onCreate }: {
  state: StoryCoinState;
  coins: number;
  onBuy: (c: CoinFace) => void;
  onOpen: (c: CoinFace) => void;
  onAll: () => void;
  onCreate: () => void;
}) {
  const face = state.kind === 'checked' || state.kind === 'top' ? state.coin : null;
  const cap = useCoinCap(face?.address ?? '', face?.marketCapUsd ?? { known: false, pending: 'not_read_yet' }, face !== null);
  const all = coins > 0 ? (
    <button type="button" className={styles['allCoins']} onClick={(e) => {
      e.stopPropagation();
      onAll();
    }}>{coins === 1 ? 'All 1 coin' : `All ${coins} coins`}</button>
  ) : null;
  return (
    <div className={styles['bar']}>
      <div className={styles['barPanel']}>
        {face !== null ? (
          <>
            <div className={styles['barCoin']} role="button" tabIndex={0} onClick={() => onOpen(face)} onKeyDown={(e) => {
              if (e.key === 'Enter') onOpen(face);
            }}>
              <CoinLogo address={face.address} ticker={face.ticker ?? face.name} imageUrl={face.imageUrl} size={48} />
              <span className={styles['barText']}>
                <span className={styles['barTop']}>
                  <b>{tickerText(face.ticker ?? face.name ?? face.address.slice(0, 4))}</b>
                  {face.changePct.known ? <span className={face.changePct.amount >= 0 ? styles['up'] : styles['down']}>{pctText(face.changePct.amount)}</span> : null}
                </span>
                <span className={styles['barSub']}>
                  {state.kind === 'top' ? <span>Top coin, not checked</span> : cap.known ? <Value r={formatUsd(cap)} /> : null}
                  {all}
                </span>
              </span>
            </div>
            <button type="button" className={styles['buy']} onClick={() => onBuy(face)}>Buy</button>
          </>
        ) : state.kind === 'none' ? (
          <>
            <span className={styles['barNone']}>
              <b>No coin yet</b>
              {all}
            </span>
            <button type="button" className={styles['buy']} onClick={onCreate}>Create</button>
          </>
        ) : (
          <span className={styles['barNone']}>
            <span>{state.kind === 'line' ? state.line : ''}</span>
            {all}
          </span>
        )}
      </div>
    </div>
  );
}
