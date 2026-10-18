/**
 * NARRATIVES — viral posts grouped by the story they are about, sorted exactly as For You's posts
 * are (the owner, 2026-10-18): the header; the sort chips New, Trending and Most viewed in For You's
 * order and style (features/feed feed-sort.ts SORTS, feed.module.css); under them the All / X /
 * TikTok pills, plain words, and on Most viewed its Today / Week / All at the right end of that row,
 * as For You's. The choice is remembered on the phone (narrative-order.ts). One card per real
 * narrative; a card opens the narrative's page.
 *
 * ★ EVERY LIST IS THE SERVER'S (services/read narrative-sorts.ts, GET /narratives/:view/all), 20 at
 * a time, the next 20 loaded as the end of the list comes into view (or on "Show 20 more"). While
 * only the first 20 are showing they are read again every minute, and a narrative whose place
 * changed glides to it (each card's move is measured before and after and animated across the gap).
 *
 * Each card: its place, picture, title; "12 posts   28m old" (and Dead); on the right its views,
 * and under them on Most viewed Today or Week "+8.1M today" / "+3.2M this week"; on Trending a line
 * under the title in For You's words, "394 views a minute, up 1.4x in the last hour"; and the coin
 * line in the owner's three states (narrative/story-coin.ts): the checked coin with its market cap
 * and Buy, a top coin said as "Top coin, not checked" with Buy, or "No coin yet" with Create. Buy
 * opens the existing Buy pop-up.
 *
 * ★ FACTS ONLY. The order is the server's; the number behind it is never sent. A card shows only
 * what a reader can check: views, views gained, views a minute, posts, age.
 *
 * What breaks if changed carelessly: Most viewed's line must be the server's views GAINED in the
 * span, never a total; a total always climbs and would make every narrative look like it is rising.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { BOARD_VIEW, fetchAllNarratives, type NarrativeListSort, type NarrativesPage, type Story } from '../../shared/api/index.ts';
import { formatUsd } from '../../shared/format/number.ts';
import { tickerText } from '../../shared/format/ticker.ts';
import { useNow } from '../../shared/hooks.ts';
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
import { SITES, cardLine, gainedIn, hourGainText, listOf, loadChoice, realNarratives, saveChoice, speedsOf, viewsText, type Choice } from './narrative-order.ts';
import styles from './narratives.module.css';

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
  const list = useList(listOf(choice), choice.site === 'all' ? null : choice.site);
  const rows = list.rows;
  const glide = useGlide(rows?.map((s) => s.id).join(' ') ?? '');
  const open = (s: Story) => (window.location.hash = hrefFor({ screen: 'story', storyId: s.id }));

  return (
    <section className={styles['screen']}>
      <header className={styles['header']}>
        <h1>Narratives</h1>
        {/* Said only when the list really is kept current (VITE_LIVE_FEED). */}
        {LIVE_FEED ? <span className={styles['live']}>Live</span> : null}
      </header>
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
      {rows !== null && rows.length === 0 ? <p className={styles['empty']}>{choice.sort === 'trending' ? NO_RISERS : 'No narratives yet.'}</p> : null}
      <div className={styles['cards']}>
        {rows?.map((s, i) => (
          <div key={s.id} ref={glide(s.id)}>
            <Card story={s} place={i + 1} view={{ sort: choice.sort, span: choice.span }} now={now} onOpen={() => open(s)} onBuy={setBuying} onCreate={() => onCreate(s)} />
          </div>
        ))}
      </div>
      {list.next !== null ? <More onMore={list.more} busy={list.state === 'loading'} failed={list.state === 'failed'} /> : null}
      {buying !== null ? <BuyOpen mint={buying.address} ticker={buying.ticker ?? buying.name ?? ''} onClose={() => setBuying(null)} onNote={setNote} /> : null}
      <SheetToast note={note} onDone={() => setNote(null)} />
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
function useList(sort: NarrativeListSort, on: 'x' | 'tiktok' | null): { readonly rows: readonly Story[] | null; readonly next: number | null; readonly provenance: NarrativesPage['provenance'] | null; readonly state: 'loading' | 'ready' | 'failed'; readonly more: () => void } {
  const key = `${sort}:${on ?? 'all'}`;
  const [got, setGot] = useState<{ key: string; rows: readonly Story[]; next: number | null; pages: number; provenance: NarrativesPage['provenance'] } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const asking = useRef<string | null>(null);
  const current = useRef(key);
  current.current = key;
  const load = (offset: number, prev: readonly Story[], pages: number, quiet = false) => {
    const ask = `${key}:${offset}:${pages}`;
    if (asking.current === ask) return;
    asking.current = ask;
    if (!quiet) setState('loading');
    fetchAllNarratives(BOARD_VIEW, sort, offset, on).then(
      (page) => {
        asking.current = null;
        if (current.current !== key) return;
        const seen = new Set(prev.map((x) => x.id));
        setGot({ key, rows: [...prev, ...realNarratives(page.stories).filter((x) => !seen.has(x.id))], next: page.next, pages: pages + 1, provenance: page.provenance });
        setState('ready');
      },
      () => {
        asking.current = null;
        if (current.current !== key || quiet) return;
        setState('failed');
      },
    );
  };
  useEffect(() => {
    setGot(null);
    load(0, [], 0);
    // `load` is a fresh closure every render; the sort and site are what decide a fresh list.
  }, [key]);
  const mine = got !== null && got.key === key ? got : null;
  const firstOnly = mine !== null && mine.pages === 1;
  useEffect(() => {
    if (!firstOnly) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(0, [], 0, true);
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [key, firstOnly]);
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
      const top = el.getBoundingClientRect().top + window.scrollY;
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
export function Card({ story, place, view, now, line, onOpen, onBuy, onCreate }: { story: Story; place: number | null; view?: { readonly sort: Choice['sort']; readonly span: ViewedSpan }; hours?: number; now: number; line?: readonly string[]; onOpen: () => void; onBuy: (c: CoinFace) => void; onCreate: () => void }) {
  const coin = storyCoinState(story);
  const right = view === undefined ? hourGainText(story) : viewsText(story);
  const gained = view?.sort === 'most_viewed' ? gainedIn(story, view.span) : null;
  const gainLine = view !== undefined && gained !== null ? gainedLine(gained, view.span) : null;
  const speeds = view?.sort === 'trending' ? speedsOf(story) : null;
  const speed = speeds === null ? null : speedLine(speeds);
  return (
    <article className={styles['card']} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => {
      if (e.key === 'Enter') onOpen();
    }}>
      <div className={styles['top']}>
        {place !== null ? <span className={styles['place']}>{place}</span> : null}
        <Thumb url={story.thumbUrl} size={64} radius={16} />
        <div className={styles['text']}>
          <b className={styles['title']}>{story.title}</b>
          <span className={styles['sub']}>
            {(line ?? cardLine(story, now)).map((w) => <span key={w}>{w}</span>)}
          </span>
          {speed !== null ? <span className={`${styles['speed']} ${speed.up ? styles['up'] : ''}`}>{speed.text}</span> : null}
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
              {coin.kind === 'top' ? 'Top coin, not checked' : <CardCap coin={coin.coin} />}
            </span>
            <button type="button" className={styles['buy']} onClick={(e) => {
              e.stopPropagation();
              onBuy(coin.coin);
            }}>Buy</button>
          </>
        ) : coin.kind === 'none' ? (
          <>
            <span className={styles['coinNone']}>No coin yet</span>
            <button type="button" className={styles['create']} onClick={(e) => {
              e.stopPropagation();
              onCreate();
            }}>Create</button>
          </>
        ) : (
          <span className={styles['coinNone']}>{coin.line}</span>
        )}
      </div>
    </article>
  );
}

/** The checked coin's market cap: the shared live one (useCoinCap), as every other cap in the app; nothing when no market reports one. */
function CardCap({ coin }: { coin: CoinFace }) {
  const cap = useCoinCap(coin.address, coin.marketCapUsd, true);
  return cap.known ? <Value r={formatUsd(cap)} /> : null;
}
