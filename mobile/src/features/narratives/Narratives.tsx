/**
 * NARRATIVES — viral posts grouped by the story they are about, as the owner drew the tab
 * (2026-10-17): the header; the chips Trending (the default), Most viewed and New, and beside them
 * the window, 1h 6h 24h, on Trending and Most viewed (narrative-order.ts says what each means and in
 * what order; the choice is remembered on the phone); one card per real narrative. A card opens the
 * narrative's page.
 *
 * Each card: its place in the list, picture, title; "3 new posts   28m old" (posts found in the
 * window, the story's age since we found it; on New, its post count); on the right the views it
 * gained in the window in green with "views 1h" under it; and the coin line in the owner's three
 * states (narrative/story-coin.ts): the checked coin with its market cap and Buy, a top coin said as
 * "Top coin, not checked" with Buy, or "No coin yet" with Create. Buy opens the existing Buy pop-up.
 *
 * ★ FACTS ONLY. Trending's order is the server's place for the window; the number behind it is never
 * sent, and the card shows only what it is made of a reader can check: views gained, new posts, age.
 *
 * ★ LIVE, LIKE FOR YOU (features/feed useLiveFeed.ts, on when the build sets VITE_LIVE_FEED=on):
 * while the tab is open and on screen a newer read slides new narratives in, and a narrative whose
 * place in the chosen order changed glides to it (each card's move is measured before and after the
 * list changes and animated across the gap), so a new ranking is seen arriving, not jumping.
 *
 * What breaks if changed carelessly: the window's gain must be the server's views GAINED in it, never
 * a total; a total always climbs and would make every narrative look like it is rising.
 */

import { useLayoutEffect, useRef, useState } from 'react';

import { BOARD_VIEW, fetchNarratives, type NarrativesList, type Story } from '../../shared/api/index.ts';
import { formatUsd } from '../../shared/format/number.ts';
import { tickerText } from '../../shared/format/ticker.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { useCoinCap } from '../../shared/useCoinCap.ts';
import { boardNotice } from '../../shared/notice.ts';
import { hrefFor } from '../../shared/route.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { LIVE_FEED } from '../feed/live-feed.ts';
import { LiveCard } from '../feed/LiveCard.tsx';
import { useLiveFeed } from '../feed/useLiveFeed.ts';
import { storyCoinState, type CoinFace } from '../narrative/story-coin.ts';
import { BuyOpen, SheetToast, type SheetNote } from '../post-sheet/index.ts';
import { ORDERS, ORDER_LABEL, WINDOWS, WINDOW_LABEL, cardLine, gainText, loadChoice, ordered, realNarratives, saveChoice, windowOf, type Choice, type WindowHours } from './narrative-order.ts';
import styles from './narratives.module.css';

/** The rows a read holds: real ones only, in the server's order (the chip sorts them). */
const rowsOf = (list: NarrativesList): readonly Story[] => realNarratives(list.stories);

/** How long a card takes to glide to its new place. */
const MOVE_MS = 320;

/** The phone's own store, or none where the browser refuses it. */
const store = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function Narratives({ onCreate }: { onCreate: (story: Story) => void }) {
  const [list, reload] = useLoad('narratives', (signal) => fetchNarratives(BOARD_VIEW, signal));
  const live = useLiveFeed(LIVE_FEED, list, reload, rowsOf, false);
  const [choice, setChoiceState] = useState<Choice>(() => loadChoice(store()));
  const setChoice = (c: Choice) => {
    setChoiceState(c);
    saveChoice(store(), c);
  };
  const [buying, setBuying] = useState<CoinFace | null>(null);
  const [note, setNote] = useState<SheetNote | null>(null);
  const now = useNow();
  const base = live.rows ?? (list.state === 'ready' ? rowsOf(list.value) : null);
  const rows = base === null ? null : ordered(base, choice);
  const hours = windowOf(choice);
  const glide = useGlide(rows?.map((s) => s.id).join(' ') ?? '');
  const open = (s: Story) => (window.location.hash = hrefFor({ screen: 'story', storyId: s.id }));

  return (
    <section className={styles['screen']}>
      <header className={styles['header']}>
        <h1>Narratives</h1>
        {/* Said only when the list really is kept current (VITE_LIVE_FEED). */}
        {LIVE_FEED ? <span className={styles['live']}>Live</span> : null}
      </header>
      <div className={styles['bar']}>
        <div className={styles['chips']} role="group" aria-label="Order">
          {ORDERS.map((o) => (
            <button key={o} type="button" className={`${styles['chip']} ${o === choice.order ? styles['chipOn'] : ''}`} aria-pressed={o === choice.order} onClick={() => setChoice({ ...choice, order: o })}>
              {ORDER_LABEL[o]}
            </button>
          ))}
        </div>
        {hours !== null && choice.order !== 'new' ? (
          <div className={styles['windows']} role="group" aria-label="Window">
            {WINDOWS.map((w) => (
              <button key={w} type="button" className={`${styles['win']} ${w === hours ? styles['winOn'] : ''}`} aria-pressed={w === hours} onClick={() => setChoice({ ...choice, windows: { ...choice.windows, [choice.order]: w } })}>
                {WINDOW_LABEL[w]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <Notice notice={list.state === 'ready' ? boardNotice(list.value.provenance) : null} />

      {list.state === 'loading' && rows === null ? <p className={styles['empty']}>Loading.</p> : null}
      {list.state === 'failed' && rows === null ? <p className={styles['empty']}>Couldn't load the narratives.</p> : null}
      {rows !== null && rows.length === 0 ? <p className={styles['empty']}>No narratives yet.</p> : null}
      <div className={styles['cards']}>
        {rows?.map((s, i) => (
          <div key={s.id} ref={glide(s.id)}>
            <LiveCard id={s.id} arrival={live.arrivals.get(s.id)}>
              <Card story={s} place={i + 1} hours={hours} now={now} onOpen={() => open(s)} onBuy={setBuying} onCreate={() => onCreate(s)} />
            </LiveCard>
          </div>
        ))}
      </div>
      {buying !== null ? <BuyOpen mint={buying.address} ticker={buying.ticker ?? buying.name ?? ''} onClose={() => setBuying(null)} onNote={setNote} /> : null}
      <SheetToast note={note} onDone={() => setNote(null)} />
    </section>
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

function Card({ story, place, hours, now, onOpen, onBuy, onCreate }: { story: Story; place: number; hours: WindowHours | null; now: number; onOpen: () => void; onBuy: (c: CoinFace) => void; onCreate: () => void }) {
  const coin = storyCoinState(story);
  /* On New, the last hour's gain: the tab's default window. */
  const h: WindowHours = hours ?? 1;
  const gain = gainText(story, h);
  return (
    <article className={styles['card']} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => {
      if (e.key === 'Enter') onOpen();
    }}>
      <div className={styles['top']}>
        <span className={styles['place']}>{place}</span>
        <Thumb url={story.thumbUrl} size={64} radius={16} />
        <div className={styles['text']}>
          <b className={styles['title']}>{story.title}</b>
          <span className={styles['sub']}>
            {cardLine(story, hours, now).map((w) => <span key={w}>{w}</span>)}
          </span>
        </div>
        <div className={styles['gain']}>
          {gain !== null ? <b className={gain.startsWith('-') ? styles['down'] : gain === '+0' ? styles['dash'] : styles['up']}>{gain}</b> : <b className={styles['dash']}>—</b>}
          <span>views {WINDOW_LABEL[h]}</span>
        </div>
      </div>
      <div className={styles['coin']}>
        {coin.kind === 'checked' || coin.kind === 'top' ? (
          <>
            <CoinLogo address={coin.coin.address} ticker={coin.coin.ticker ?? coin.coin.name} imageUrl={coin.coin.imageUrl} size={28} />
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
