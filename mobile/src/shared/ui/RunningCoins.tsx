/**
 * THE RUNNING COINS STRIP — a slim tape under the screen title of For You and the Narratives tab
 * (the owner, 2026-10-23, design A of reports/ticker): each coin's logo, ticker, market cap and
 * 24-hour move, sliding slowly left like a stock ticker. A tap opens that coin's page.
 *
 * ★ EACH CAP IS LIVE: the server's figure, then every trade as it lands (useCoinCap, the live line).
 *
 * ★ WHICH COINS IS THE SERVER'S CALL (services/read running-coins.ts): only the one coin of a post
 * or narrative we found, launched on the launchpad, with a fresh price and real trading in the last
 * hour, most dollars traded first. This file draws them in that order and decides nothing about them.
 *
 * ★ NO EMPTY BAR, AND NO JUMP. While the first answer is on its way the strip's height is held (an
 * empty tape, so the tabs under it do not move when it lands); the last answer is kept on the phone,
 * so after the first visit it is drawn at once. An answer with no coins, or a failed read, removes
 * the strip entirely: an empty tape would read as "nothing is trading", which is not what it means.
 *
 * ★ THE LOOP IS SEAMLESS AT ONE SPEED. The coins are drawn twice in a row and the row slides by
 * exactly one copy, so the end meets the start. A copy narrower than the screen (two or three coins)
 * repeats its coins until it is wider, or the loop would show a gap. The duration follows the copy's
 * width, so twelve coins and three move at the same reading speed (about 35 s a loop for twelve).
 *
 * ★ IT STOPS FOR A FINGER, AND A FINGER CAN SLIDE IT. Pressing on it pauses the slide (and a mouse
 * over it, on a computer), so a coin can be read and tapped where it is; dragging moves it either
 * way, and on release it rotates on at its own speed from there. Reduce Motion: no slide at all; one
 * copy, scrolled by hand.
 *
 * What breaks if changed carelessly: the second copy must stay `aria-hidden` and out of the tab order,
 * or a screen reader reads every coin twice; and the purple of the app never appears here (the
 * owner's rule: purple is main buttons, charts, the selected tab and state, not a ticker).
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

import { fetchRunningCoins, type RunningCoin } from '../api/index.ts';
import { known } from '../format/measure.ts';
import { useLoad } from '../hooks.ts';
import { hrefFor } from '../route.ts';
import { stripCap, stripMove } from '../running-coins.ts';
import { tickerText } from '../format/ticker.ts';
import { useScreenActive } from '../screen-active.ts';
import { useCoinCap } from '../useCoinCap.ts';
import { CoinLogo } from './CoinLogo.tsx';
import styles from './running-coins.module.css';

/** The slide's speed in points a second: twelve coins (about 2,250 points of tape) loop in about 37 s. */
const POINTS_PER_SECOND = 60;
/** Reduce Motion, read once: the strip is then one still copy, scrolled by hand. */
const STILL = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
/** A finger that moves further than this is dragging the tape, not tapping a coin. */
const DRAG_PX = 6;
/** How often the strip is read again while its screen is showing; the server keeps one list 30 s. */
const REREAD_MS = 60_000;

function Item({ coin, hidden }: { coin: RunningCoin; hidden: boolean }) {
  const move = stripMove(coin.change24hPct);
  const tone = move.direction === 'up' ? styles['up'] : move.direction === 'down' ? styles['down'] : styles['flat'];
  /* ★ THE CAP MOVES WITH EVERY TRADE (the owner, 2026-10-27: "update market cap on tape more
     frequently"): the server's figure, then each trade as it lands on the live line, as every other cap. */
  const cap = useCoinCap(coin.address, known(coin.marketCapUsd));
  return (
    <a className={styles['item']} href={hrefFor({ screen: 'token', coinId: coin.coinId })} tabIndex={hidden ? -1 : undefined} aria-hidden={hidden ? true : undefined} draggable={false}>
      <CoinLogo address={coin.address} ticker={coin.ticker} imageUrl={coin.imageUrl} size={20} small eager />
      <span className={styles['ticker']}>{tickerText(coin.ticker)}</span>
      <span className={styles['cap']}>{stripCap(cap.known ? cap.amount : coin.marketCapUsd)}</span>
      <span className={`${styles['move']} ${tone}`}>{move.text}</span>
    </a>
  );
}

export function RunningCoins() {
  const [load, reload] = useLoad('running-coins', fetchRunningCoins, 'phone');
  const active = useScreenActive();
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, REREAD_MS);
    return () => window.clearInterval(id);
  }, [active, reload]);

  const coins = load.state === 'ready' ? load.value : null;
  const strip = useRef<HTMLDivElement | null>(null);
  const copy = useRef<HTMLDivElement | null>(null);
  const [reps, setReps] = useState(1);
  const [copyWidth, setCopyWidth] = useState(0);
  /* ★ A FINGER CAN SLIDE IT (the owner, 2026-10-27: "I want to also be able to slide on the tape,
     don't change the rotation"). The slide is driven here, not by a CSS animation, so a drag moves the
     same offset the rotation moves: it rotates at the same speed in the same direction, a finger drags
     it either way, and on release it rotates on from where the finger left it. A drag never opens a coin. */
  const runRef = useRef<HTMLDivElement | null>(null);
  const offset = useRef(0);
  const held = useRef(false);
  const drag = useRef<{ readonly x: number; readonly from: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const key = coins?.map((c) => c.address).join(' ') ?? '';

  /* One copy at least as wide as the strip; measured again when the coins or the width change. */
  useLayoutEffect(() => {
    const s = strip.current;
    const c = copy.current;
    if (s === null || c === null || STILL) return;
    const measure = () => {
      const one = c.scrollWidth / reps;
      if (one <= 0) return;
      const need = Math.max(1, Math.ceil(s.clientWidth / one));
      if (need !== reps) setReps(need);
      else setCopyWidth(c.scrollWidth);
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(s);
    return () => ro?.disconnect();
  }, [key, reps]);

  useEffect(() => {
    if (STILL || copyWidth <= 0) return undefined;
    let last = performance.now();
    let frame = 0;
    const tick = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      if (!held.current && drag.current === null) offset.current += POINTS_PER_SECOND * dt;
      offset.current = ((offset.current % copyWidth) + copyWidth) % copyWidth;
      if (runRef.current !== null) runRef.current.style.transform = `translateX(${-offset.current}px)`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [copyWidth]);

  if (load.state === 'failed' || (coins !== null && coins.length === 0)) return null;

  const one = coins === null ? [] : Array.from({ length: reps }, () => coins).flat();
  const run: CSSProperties = copyWidth > 0 ? ({ '--loop': `${(copyWidth / POINTS_PER_SECOND).toFixed(1)}s` } as CSSProperties) : {};
  const release = () => {
    drag.current = null;
    held.current = false;
  };
  return (
    <div
      ref={strip}
      className={styles['strip']}
      role="region"
      aria-label="Running coins"
      onPointerDown={(e) => {
        held.current = true;
        dragged.current = false;
        drag.current = { x: e.clientX, from: offset.current, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d === null) return;
        const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) > DRAG_PX) {
          d.moved = true;
          dragged.current = true;
          strip.current?.setPointerCapture?.(e.pointerId);
        }
        if (d.moved) offset.current = d.from - dx;
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') release();
      }}
      onMouseEnter={() => {
        held.current = true;
      }}
      onMouseLeave={release}
      onClickCapture={(e) => {
        /* A drag ends on a coin; it is a drag, not a tap. */
        if (dragged.current) {
          e.preventDefault();
          e.stopPropagation();
          dragged.current = false;
        }
      }}
    >
      <div ref={runRef} className={styles['run']} style={run}>
        <div ref={copy} className={styles['copy']}>
          {one.map((c, i) => (
            <Item key={`${c.address}:${i}`} coin={c} hidden={i >= (coins?.length ?? 0)} />
          ))}
        </div>
        {STILL ? null : (
          <div className={`${styles['copy']} ${styles['again']}`} aria-hidden="true">
            {one.map((c, i) => (
              <Item key={`${c.address}:${i}`} coin={c} hidden />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
