/**
 * NARRATIVES — viral posts grouped by the story they are about, as the owner drew the tab
 * (2026-10-17): the header, the chips Fastest (the default: views gained in the last hour), Most
 * views and Newest, and one card per real narrative (narrative-order.ts says which and in what
 * order). A card opens the narrative's page.
 *
 * Each card: picture, title, "N posts   X views"; a small line of the views it gained (thin purple,
 * a soft fade under it, no dots: the projector's five-minute gains added up, gain-chart.ts); "Last
 * hour" with its gain in green; and the coin line in the owner's three states (narrative/
 * story-coin.ts): the checked coin with its market cap and a purple Buy, a top coin said as "Top
 * coin, not checked" with Buy, or "No coin yet" with Create. Buy opens the existing Buy pop-up.
 *
 * ★ LIVE, LIKE FOR YOU (features/feed useLiveFeed.ts, on when the build sets VITE_LIVE_FEED=on):
 * while the tab is open and on screen a newer read slides new narratives in, and a narrative whose
 * place in the chosen order changed glides to it (each card's move is measured before and after the
 * list changes and animated across the gap), so a new ranking is seen arriving, not jumping.
 *
 * What breaks if changed carelessly: a card's sparkline must stay the views GAINED (the owner's
 * line), not the total; a total always climbs and would make every narrative look like it is rising.
 */

import { useLayoutEffect, useRef, useState } from 'react';

import { BOARD_VIEW, fetchNarratives, type NarrativesList, type Story } from '../../shared/api/index.ts';
import { formatUsd } from '../../shared/format/number.ts';
import { tickerText } from '../../shared/format/ticker.ts';
import { useLoad } from '../../shared/hooks.ts';
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
import { BuyOpen, SheetToast, buckets, smoothPath, sparkInterval, type GainSlots, type SheetNote } from '../post-sheet/index.ts';
import { ORDERS, ORDER_LABEL, lastHourGain, ordered, postsLine, realNarratives, type Order } from './narrative-order.ts';
import styles from './narratives.module.css';

/** The rows a read holds: real ones only, in the server's order (the chip sorts them). */
const rowsOf = (list: NarrativesList): readonly Story[] => realNarratives(list.stories);

/** How long a card takes to glide to its new place. */
const MOVE_MS = 320;

export function Narratives({ onCreate }: { onCreate: (story: Story) => void }) {
  const [list, reload] = useLoad('narratives', (signal) => fetchNarratives(BOARD_VIEW, signal));
  const live = useLiveFeed(LIVE_FEED, list, reload, rowsOf, false);
  const [order, setOrder] = useState<Order>('fastest');
  const [buying, setBuying] = useState<CoinFace | null>(null);
  const [note, setNote] = useState<SheetNote | null>(null);
  const base = live.rows ?? (list.state === 'ready' ? rowsOf(list.value) : null);
  const rows = base === null ? null : ordered(base, order);
  const glide = useGlide(rows?.map((s) => s.id).join(' ') ?? '');
  const open = (s: Story) => (window.location.hash = hrefFor({ screen: 'story', storyId: s.id }));

  return (
    <section className={styles['screen']}>
      <header className={styles['header']}>
        <h1>Narratives</h1>
        {/* Said only when the list really is kept current (VITE_LIVE_FEED). */}
        {LIVE_FEED ? <span className={styles['live']}>Live</span> : null}
      </header>
      <div className={styles['chips']} role="group" aria-label="Order">
        {ORDERS.map((o) => (
          <button key={o} type="button" className={`${styles['chip']} ${o === order ? styles['chipOn'] : ''}`} aria-pressed={o === order} onClick={() => setOrder(o)}>
            {ORDER_LABEL[o]}
          </button>
        ))}
      </div>

      <Notice notice={list.state === 'ready' ? boardNotice(list.value.provenance) : null} />

      {list.state === 'loading' && rows === null ? <p className={styles['empty']}>Loading.</p> : null}
      {list.state === 'failed' && rows === null ? <p className={styles['empty']}>Couldn't load the narratives.</p> : null}
      {rows !== null && rows.length === 0 ? <p className={styles['empty']}>No narratives yet.</p> : null}
      <div className={styles['cards']}>
        {rows?.map((s) => (
          <div key={s.id} ref={glide(s.id)}>
            <LiveCard id={s.id} arrival={live.arrivals.get(s.id)}>
              <Card story={s} onOpen={() => open(s)} onBuy={setBuying} onCreate={() => onCreate(s)} />
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

function Card({ story, onOpen, onBuy, onCreate }: { story: Story; onOpen: () => void; onBuy: (c: CoinFace) => void; onCreate: () => void }) {
  const coin = storyCoinState(story);
  const gain = lastHourGain(story);
  return (
    <article className={styles['card']} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => {
      if (e.key === 'Enter') onOpen();
    }}>
      <div className={styles['top']}>
        <Thumb url={story.thumbUrl} size={52} radius={14} />
        <div className={styles['text']}>
          <b className={styles['title']}>{story.title}</b>
          <span className={styles['sub']}>
            {postsLine(story).map((w) => <span key={w}>{w}</span>)}
          </span>
        </div>
        {story.viewsGained !== null ? <Spark slots={story.viewsGained} /> : null}
      </div>
      <div className={styles['hour']}>
        <span>Last hour</span>
        {gain !== null ? <b className={gain.startsWith('-') ? styles['down'] : styles['up']}>{gain}</b> : <span>—</span>}
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

const SPARK_W = 92;
const SPARK_H = 30;

/** The views gained, as a thin purple line with a soft fade under it; nothing drawn from fewer than two points. */
function Spark({ slots }: { slots: GainSlots }) {
  const bs = buckets(slots, sparkInterval(slots));
  const max = Math.max(1, ...bs.map((b) => b.value ?? 0));
  const n = bs.length;
  if (bs.filter((b) => b.value !== null).length < 2) return null;
  const runs: { x: number; y: number }[][] = [];
  let open = false;
  bs.forEach((b, i) => {
    if (b.value === null) {
      open = false;
      return;
    }
    if (!open) runs.push([]);
    open = true;
    runs[runs.length - 1]?.push({ x: (i / Math.max(1, n - 1)) * SPARK_W, y: 2 + (SPARK_H - 4) * (1 - b.value / max) });
  });
  return (
    <svg className={styles['spark']} width={SPARK_W} height={SPARK_H} aria-hidden="true">
      <defs>
        <linearGradient id="nspark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#B48CFF" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#B48CFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      {runs.map((r, i) => {
        const d = smoothPath(r);
        const a = r[0];
        const z = r[r.length - 1];
        if (a === undefined || z === undefined) return null;
        return (
          <g key={i}>
            {r.length > 1 ? <path d={`${d}L${z.x},${SPARK_H}L${a.x},${SPARK_H}Z`} fill="url(#nspark)" /> : null}
            <path d={d} fill="none" stroke="#B48CFF" strokeWidth={1.5} strokeLinecap="round" />
          </g>
        );
      })}
    </svg>
  );
}
