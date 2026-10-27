/**
 * NARRATIVES — viral posts grouped by the story they are about, sorted exactly as For You's posts
 * are (the owner, 2026-10-18): the header; the sort chips New, Trending and Most viewed in For You's
 * order and style (features/feed feed-sort.ts SORTS, feed.module.css); under them the All / X /
 * TikTok pills, plain words, with "No coin yet" beside them for creators (it combines with the site), and on Most viewed its Today / Week / All at the right end of that row,
 * as For You's. The choice is remembered on the phone (narrative-order.ts). One card per real
 * narrative; a card opens the narrative's page.
 *
 * ★ EVERY LIST IS THE SERVER'S (services/read narrative-sorts.ts, GET /narratives/:view/all), 20 at
 * a time, the next 20 loaded as the end of the list comes into view (or on "Show 20 more"). While
 * only the first 20 are showing they are read again every minute, and a narrative whose place
 * changed glides to it (each card's move is measured before and after and animated across the gap).
 *
 * ★ THE ONLINE MEME WARS BETWEEN COUNTRIES are one card, "Twitter World War", standing where the
 * first of them is in the server's order; it opens their sections (world-war.ts, WorldWar.tsx).
 *
 * Each card: its place, picture, title; "12 posts   28m old" (and Dead); on the right its views,
 * and under them on Most viewed Today or Week "+8.1M today" / "+3.2M this week"; on Trending a line
 * under the title in For You's words, "394 views a minute, up 1.4x in the last hour"; and the coin
 * line in the owner's three states (narrative/story-coin.ts): the checked coin with its market cap
 * and Buy, a top coin said as "Top coin, not checked" with Buy, or "No coin yet" with Create — and,
 * left of Create, "See N coins" when coins were made after its oldest post (the server's
 * `coinsMade`, the count its page's Choose coin lists), which opens the page on that pop-up. Buy
 * opens the existing Buy pop-up.
 *
 * ★ FACTS ONLY. The order is the server's; the number behind it is never sent. A card shows only
 * what a reader can check: views, views gained, views a minute, posts, age.
 *
 * What breaks if changed carelessly: Most viewed's line must be the server's views GAINED in the
 * span, never a total; a total always climbs and would make every narrative look like it is rising.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { BOARD_VIEW, fetchAllNarratives, type NarrativeListSort, type NarrativesPage, type Story } from '../../shared/api/index.ts';
import type { Measured } from '../../shared/format/measure.ts';
import { formatUsd } from '../../shared/format/number.ts';
import { tickerText } from '../../shared/format/ticker.ts';
import { useNow } from '../../shared/hooks.ts';
import { fresh, kept } from '../../shared/kept-reads.ts';
import { firstPageKey, readFirstPage } from './first-page.ts';
import { useScreenActive } from '../../shared/screen-active.ts';
import { useCoinCap } from '../../shared/useCoinCap.ts';
import { boardNotice } from '../../shared/notice.ts';
import { hrefFor } from '../../shared/route.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { NO_RISERS, SORTS, SPANS, gainedLine, speedLine, type ViewedSpan } from '../feed/feed-sort.ts';
import feedStyles from '../feed/feed.module.css';
import { LIVE_FEED } from '../feed/live-feed.ts';
import { storyCoinState, type CoinFace } from '../narrative/story-coin.ts';
import { BuyOpen, SheetToast, type SheetNote } from '../post-sheet/index.ts';
import { NO_COIN_PILL, SITES, cardLine, seeCoinsText, gainedIn, hourGainText, listOf, loadChoice, realNarratives, saveChoice, speedsOf, viewsText, viralLine, type Choice } from './narrative-order.ts';
import { WindowList } from '../../shared/ui/WindowList.tsx';
import { WarCard } from './WorldWar.tsx';
import { itemKey, withWarUmbrella, type ListItem } from './world-war.ts';
import { useIsOwner } from '../owner/hooks.ts';
import { NarrativeHideBar, NotANarrativeStrip, useHiddenNarratives } from '../owner/OwnerNarrative.tsx';
import { ScreenHeader, ScreenTitle } from '../../shared/ui/ScreenHeader.tsx';
import { RunningCoins } from '../../shared/ui/RunningCoins.tsx';
import styles from './narratives.module.css';
import { scrollTopNow } from '../../shared/scroller.ts';

/** The space between two cards (narratives.module.css .cards had it as its gap). */
const CARD_GAP_PX = 10;
/** A card's height before it is measured, and how far beyond the screen cards stay drawn. */
const CARD_GUESS_PX = 150;
const CARDS_BEYOND_PX = 1200;
/** How long a card takes to glide to its new place. */
const MOVE_MS = 320;
/** How often the first 20 are read again while they are all that is showing. */
const REFRESH_MS = 60_000;

/** The phone's own store, or none where the browser refuses it. */
const store = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function Narratives({ onCreate }: { onCreate: (story: Story) => void }) {
  const [choice, setChoiceState] = useState<Choice>(() => loadChoice(store()));
  const setChoice = (c: Choice) => {
    setChoiceState(c);
    saveChoice(store(), c);
  };
  const [buying, setBuying] = useState<CoinFace | null>(null);
  const [note, setNote] = useState<SheetNote | null>(null);
  const now = useNow();
  const list = useList(listOf(choice), choice.site === 'all' ? null : choice.site, choice.noCoin);
  /* The owner's "Not a narrative" (features/owner/OwnerNarrative.tsx): drawn only for the owner, and a card it hid leaves at once. */
  const owner = useIsOwner();
  const { hidden } = useHiddenNarratives();
  const rows = useMemo(() => (list.rows === null || hidden.size === 0 ? list.rows : list.rows.filter((s) => !hidden.has(s.id))), [list.rows, hidden]);
  /* The meme wars gathered under one card where the first of them stood (world-war.ts). */
  const items = useMemo(() => (rows === null ? null : withWarUmbrella(rows)), [rows]);
  const glide = useGlide(items?.map(itemKey).join(' ') ?? '');
  const places = useMemo(() => new Map((items ?? []).map((x, i) => [itemKey(x), i])), [items]);
  const open = (s: Story) => (window.location.hash = hrefFor({ screen: 'story', storyId: s.id }));

  return (
    <section className={styles['screen']}>
      <ScreenHeader as="header" gutter className={styles['header']}>
        <ScreenTitle>Narratives</ScreenTitle>
        {/* Said only when the list really is kept current (VITE_LIVE_FEED). */}
        {LIVE_FEED ? <span className={styles['live']}>Live</span> : null}
      </ScreenHeader>
      {/* The coins of the posts we found that are trading now (shared/ui/RunningCoins.tsx). */}
      <RunningCoins />
      <div className={feedStyles['sortRow']}>
        <div className={feedStyles['sorts']} role="group" aria-label="Sort">
          {SORTS.map((o) => (
            <button key={o.key} type="button" className={`${feedStyles['sortChip']} ${o.key === choice.sort ? feedStyles['sortOn'] : ''}`} aria-pressed={o.key === choice.sort} onClick={() => setChoice({ ...choice, sort: o.key })}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className={feedStyles['filterRow']}>
        <div className={feedStyles['quick']} role="group" aria-label="Site">
          {SITES.map((p) => (
            <button key={p.key} type="button" className={`${feedStyles['quickPill']} ${p.key === choice.site ? feedStyles['quickOn'] : ''}`} aria-pressed={p.key === choice.site} onClick={() => setChoice({ ...choice, site: p.key })}>
              {p.label}
            </button>
          ))}
          <button type="button" className={`${feedStyles['quickPill']} ${choice.noCoin ? feedStyles['quickOn'] : ''}`} aria-pressed={choice.noCoin} onClick={() => setChoice({ ...choice, noCoin: !choice.noCoin })}>
            {NO_COIN_PILL}
          </button>
        </div>
        {choice.sort === 'most_viewed' ? (
          <div className={feedStyles['windows']} role="group" aria-label="Window">
            {SPANS.map((w) => (
              <button key={w.key} type="button" className={w.key === choice.span ? feedStyles['windowOn'] : ''} aria-pressed={w.key === choice.span} onClick={() => setChoice({ ...choice, span: w.key })}>
                {w.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <Notice notice={list.provenance === null ? null : boardNotice(list.provenance)} />

      {list.state === 'loading' && rows === null ? <p className={styles['empty']}>Loading.</p> : null}
      {list.state === 'failed' && rows === null ? <p className={styles['empty']}>Couldn't load the narratives.</p> : null}
      {rows !== null && rows.length === 0 ? <p className={styles['empty']}>{choice.noCoin ? 'No narratives here with no coin yet.' : choice.sort === 'trending' ? NO_RISERS : 'No narratives yet.'}</p> : null}
      <div className={styles['cards']}>
        {/* Only the cards near the screen are drawn (shared/ui/WindowList.tsx), so a list scrolled
            through many pages stays smooth; the gap between cards is each card's own top space,
            the first card's none, as the column's gap was. */}
        {items !== null && items.length > 0 ? (
          <WindowList<ListItem>
            items={items}
            keyOf={itemKey}
            render={(x) => {
              const i = places.get(itemKey(x)) ?? 0;
              if (x.kind === 'war') {
                return (
                  <div ref={glide(itemKey(x))} style={i === 0 ? undefined : { paddingTop: CARD_GAP_PX }}>
                    <WarCard stories={x.stories} place={i + 1} now={now} trending={choice.sort === 'trending'} />
                  </div>
                );
              }
              const s = x.story;
              return (
                <div ref={glide(s.id)} style={i === 0 ? undefined : { paddingTop: CARD_GAP_PX }}>
                  <Card story={s} place={i + 1} view={{ sort: choice.sort, span: choice.span }} now={now} onOpen={() => open(s)} onBuy={setBuying} onCreate={() => onCreate(s)} extra={owner ? <NotANarrativeStrip storyId={s.id} /> : null} />
                </div>
              );
            }}
            guess={CARD_GUESS_PX}
            overscan={CARDS_BEYOND_PX}
            nearEnd={0}
          />
        ) : null}
      </div>
      {list.next !== null ? <More onMore={list.more} busy={list.state === 'loading'} failed={list.state === 'failed'} /> : null}
      {buying !== null ? <BuyOpen mint={buying.address} ticker={buying.ticker ?? buying.name ?? ''} onClose={() => setBuying(null)} onNote={setNote} /> : null}
      <SheetToast note={note} onDone={() => setNote(null)} />
      {owner ? <NarrativeHideBar /> : null}
    </section>
  );
}

/**
 * The server's list for `sort` and `on`, 20 at a time: the first page when the choice turns to it,
 * then each next page on `more`. A page already asked for is not asked twice, and a story already
 * listed is not listed again if the list moved between two pages. While only the first page is
 * showing it is read again every minute, so the list stays current; once more are loaded it holds
 * still, so a scrolled list does not move under the thumb.
 */
type Got = { key: string; rows: readonly Story[]; next: number | null; pages: number; provenance: NarrativesPage['provenance'] };

function keptFirst(key: string, sort: NarrativeListSort, on: 'x' | 'tiktok' | null, noCoin: boolean): Got | null {
  const k = kept<NarrativesPage>(firstPageKey(sort, on, noCoin));
  return k === undefined ? null : { key, rows: realNarratives(k.value.stories), next: k.value.next, pages: 1, provenance: k.value.provenance };
}

function useList(sort: NarrativeListSort, on: 'x' | 'tiktok' | null, noCoin: boolean): { readonly rows: readonly Story[] | null; readonly next: number | null; readonly provenance: NarrativesPage['provenance'] | null; readonly state: 'loading' | 'ready' | 'failed'; readonly more: () => void } {
  const key = `${sort}:${on ?? 'all'}:${noCoin ? 'no-coin' : 'any'}`;
  /* The list as this phone last read it, at once; the first page is read again under it. */
  const [got, setGot] = useState<Got | null>(() => keptFirst(key, sort, on, noCoin));
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>(() => (got === null ? 'loading' : 'ready'));
  const asking = useRef<string | null>(null);
  const current = useRef(key);
  current.current = key;
  const load = (offset: number, prev: readonly Story[], pages: number, quiet = false, standIn = false) => {
    const ask = `${key}:${offset}:${pages}`;
    if (asking.current === ask) return;
    asking.current = ask;
    if (!quiet) setState('loading');
    /* The first page goes through the kept reads, so a read ahead (shared/prefetch.ts) is shared, and the answer is kept for next time. */
    (offset === 0 ? fresh(firstPageKey(sort, on, noCoin), readFirstPage(sort, on, noCoin), true) : fetchAllNarratives(BOARD_VIEW, sort, offset, on, noCoin)).then(
      (page) => {
        asking.current = null;
        if (current.current !== key) return;
        const seen = new Set(prev.map((x) => x.id));
        setGot({ key, rows: [...prev, ...realNarratives(page.stories).filter((x) => !seen.has(x.id))], next: page.next, pages: pages + 1, provenance: page.provenance });
        setState('ready');
      },
      () => {
        asking.current = null;
        if (current.current !== key) return;
        /* Over a kept list, a failed first read is still a failure: the old list is not left standing as if current. */
        if (standIn) {
          setGot(null);
          setState('failed');
          return;
        }
        if (quiet) return;
        setState('failed');
      },
    );
  };
  useEffect(() => {
    const was = keptFirst(key, sort, on, noCoin);
    setGot(was);
    if (was !== null) setState('ready');
    load(0, [], 0, was !== null, was !== null);
    // `load` is a fresh closure every render; the sort, site and coin pill (all in `key`) decide a fresh list.
  }, [key]);
  const mine = got !== null && got.key === key ? got : null;
  const firstOnly = mine !== null && mine.pages === 1;
  /* Hidden behind another tab (App.tsx keeps it open), the list asks nothing; back on screen, the first page is read again. */
  const active = useScreenActive();
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current && firstOnly) load(0, [], 0, true);
    wasActive.current = active;
  }, [active]);
  useEffect(() => {
    if (!firstOnly || !active) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(0, [], 0, true);
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [key, firstOnly, active]);
  return {
    rows: mine?.rows ?? null,
    next: mine?.next ?? null,
    provenance: mine?.provenance ?? null,
    state,
    more: () => {
      if (mine !== null && mine.next !== null) load(mine.next, mine.rows, mine.pages);
    },
  };
}

/** The next 20: loaded when this comes into view, or on a tap where the phone cannot watch the scroll. */
function More({ onMore, busy, failed }: { onMore: () => void; busy: boolean; failed: boolean }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof IntersectionObserver === 'undefined' || failed) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onMore();
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  });
  return (
    <button ref={ref} type="button" className={styles['more']} onClick={onMore} aria-busy={busy}>
      {busy ? 'Loading.' : failed ? "Couldn't load more. Try again" : 'Show 20 more'}
    </button>
  );
}

/**
 * Cards that changed place glide there: each card's top is read before the browser paints the new
 * order, and a card that moved starts where it was and slides to where it is.
 */
function useGlide(key: string): (id: string) => (el: HTMLDivElement | null) => void {
  const els = useRef(new Map<string, HTMLDivElement>());
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    for (const [id, el] of els.current) {
      const top = el.getBoundingClientRect().top + scrollTopNow();
      next.set(id, top);
      const was = tops.current.get(id);
      if (was === undefined || Math.abs(was - top) < 1) continue;
      el.animate([{ transform: `translateY(${was - top}px)` }, { transform: 'translateY(0)' }], { duration: MOVE_MS, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    tops.current = next;
  }, [key]);
  return (id) => (el) => {
    if (el === null) els.current.delete(id);
    else els.current.set(id, el);
  };
}

/**
 * One narrative card. Home's Watchlist draws the same card (features/feed/Feed.tsx) with no place,
 * no `view`, and its own line under the title (`line`: posts and views, narrative-order.ts
 * watchLine); there the right side is the last hour's gain, as it always was. `hours` is what the
 * Watchlist still passes and is not read.
 */
export function Card({ story, place, view, now, line, onOpen, onBuy, onCreate, extra = null }: { story: Story; place: number | null; view?: { readonly sort: Choice['sort']; readonly span: ViewedSpan }; hours?: number; now: number; line?: readonly string[]; onOpen: () => void; onBuy: (c: CoinFace) => void; onCreate: () => void; extra?: ReactNode }) {
  const coin = storyCoinState(story);
  const seeCoins = seeCoinsText(story.coinsMade);
  const right = view === undefined ? hourGainText(story) : viewsText(story);
  const gained = view?.sort === 'most_viewed' ? gainedIn(story, view.span) : null;
  const speeds = view?.sort === 'trending' ? speedsOf(story) : null;
  const speed = speeds === null ? null : speedLine(speeds);
  const viral = view?.sort === 'trending' ? viralLine([story]) : null;
  /* Trending filled from the last hour's gains (core narrativeTrendingIds) when too few have speeds: such a card says its gain, the reason it is listed. */
  const hourGain = view?.sort === 'trending' && speeds === null ? hourGainText(story) : null;
  const gainLine = view !== undefined && gained !== null ? gainedLine(gained, view.span) : hourGain !== null && hourGain !== '+0' && !hourGain.startsWith('-') ? { text: `${hourGain} last hour`, up: true } : null;
  return (
    <article className={styles['card']} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => {
      if (e.key === 'Enter') onOpen();
    }}>
      <div className={styles['top']}>
        {place !== null ? <span className={styles['place']}>{place}</span> : null}
        <Thumb url={story.thumbUrl} file={story.thumbFile} size={64} radius={16} hideEmpty />
        <div className={styles['text']}>
          <b className={styles['title']}>{story.title}</b>
          <span className={styles['sub']}>
            {(line ?? cardLine(story, now)).map((w) => <span key={w}>{w}</span>)}
          </span>
          {speed !== null ? <span className={`${styles['speed']} ${speed.up ? styles['up'] : ''}`}>{speed.text}</span> : null}
          {/* Listed on Trending for its viral posts (services/read narrative-sorts.ts, policy.v162): the fact it is listed by. */}
          {speed === null && viral !== null ? <span className={`${styles['speed']} ${styles['up']}`}>{viral}</span> : null}
        </div>
        <div className={styles['gain']}>
          {view === undefined
            ? right !== null ? <b className={right.startsWith('-') ? styles['down'] : right === '+0' ? styles['dash'] : styles['up']}>{right}</b> : <b className={styles['dash']}>—</b>
            : right !== null ? <b className={styles['views']}>{right}</b> : <b className={styles['dash']} title="No post reported its views">—</b>}
          <span>{view === undefined ? 'views 1h' : 'views'}</span>
          {gainLine !== null ? <span className={gainLine.up ? styles['up'] : ''}>{gainLine.text}</span> : null}
        </div>
      </div>
      <div className={styles['coin']}>
        {coin.kind === 'checked' || coin.kind === 'top' ? (
          <>
            <CoinLogo small address={coin.coin.address} ticker={coin.coin.ticker ?? coin.coin.name} imageUrl={coin.coin.imageUrl} size={28} />
            <b className={styles['ticker']}>{tickerText(coin.coin.ticker ?? coin.coin.name ?? coin.coin.address.slice(0, 4))}</b>
            <span className={styles['coinSub']}>
              {coin.kind === 'top' ? 'Top coin, not checked' : <CardCap coin={coin.coin} story={story} />}
            </span>
            <button type="button" className={styles['buy']} onClick={(e) => {
              e.stopPropagation();
              onBuy(coin.coin);
            }}>Buy</button>
          </>
        ) : coin.kind === 'none' ? (
          <>
            <span className={styles['coinNone']}>No coin yet</span>
            {/* The coins made after its oldest post, as its page's Choose coin lists them (the owner, 2026-10-24). */}
            {seeCoins !== null ? (
              <button type="button" className={styles['seeCoins']} onClick={(e) => {
                e.stopPropagation();
                window.location.hash = hrefFor({ screen: 'story', storyId: story.id, coins: true });
              }}>{seeCoins}</button>
            ) : null}
            <button type="button" className={styles['create']} onClick={(e) => {
              e.stopPropagation();
              onCreate();
            }}>Create</button>
          </>
        ) : (
          <span className={styles['coinNone']}>{coin.line}</span>
        )}
      </div>
      {extra}
    </article>
  );
}

/**
 * The checked coin's market cap, by the one rule every cap in the app follows (useCoinCap): a price
 * another screen read just now, else the price the list itself carried for the coin, else the
 * list's cap; nothing when no market reports one.
 *
 * ★ THE CARD READS NO MARKET OF ITS OWN, as For You's card does not (shared/ui/PostRow.tsx). Each
 * card used to read its coin's whole one-minute chart every four seconds, up to eight at once, only
 * to print this number. The list's page carries the coin's stored price and cap (the market pass
 * reads every live narrative's coins, services/market db.ts), so one list read is the whole cost.
 */
function CardCap({ coin, story }: { coin: CoinFace; story: Story }) {
  const cap = useCoinCap(coin.address, coin.marketCapUsd, false, servedPrice(story, coin.address));
  return cap.known ? <Value r={formatUsd(cap)} num /> : null;
}

/** The price the list sent for one of the narrative's coins, or null when it sent none for that address. */
function servedPrice(story: Story, address: string): Measured | null {
  const coins = story.coins.kind === 'one' ? [story.coins.coin] : story.coins.kind === 'several' ? story.coins.coins : [];
  const c = [...coins, ...(story.topCoin === null ? [] : [story.topCoin])].find((x) => x.address === address);
  return c?.priceUsd ?? null;
}
