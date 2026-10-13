/**
 * ONE CARD ON THE LIVE FOR YOU LIST: the wrapper round a PostRow that lets a new post slide in at
 * the top and glow briefly, like a new trade on the token page (features/token TradesPanel's
 * trade-in), and that carries the id useLiveFeed.ts finds again to hold the screen still.
 *
 * A wrapper rather than a change to PostRow, so the card itself is drawn exactly as everywhere
 * else and the live list can be switched off without touching it.
 *
 * ★ THE GLOW STARTS WHEN THE CARD IS FIRST ON SCREEN, not when it is added: a post that went in
 * above somebody who had scrolled down is still lit when they scroll back up to it. Each post
 * plays its arrival once per visit to the app, so a filter that redraws the list does not replay
 * it. With reduced motion there is no slide and no stagger, only the glow fading.
 *
 * What breaks if changed carelessly: leaving `overflow: hidden` on after the slide clips anything
 * the card opens over its edges; giving the wrapper its own margin moves every card on the list.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Arrival } from './useLiveFeed.ts';
import { LIVE_ID_ATTR } from './useLiveFeed.ts';
import styles from './live.module.css';

/** The slide's length; live.module.css says the same 300ms. */
const SLIDE_MS = 300;

/** Posts that have already played their arrival in this visit. */
const PLAYED = new Set<string>();

export function LiveCard({ id, arrival, children }: { id: string; arrival: Arrival | undefined; children: ReactNode }) {
  const [mode] = useState<Arrival | null>(() => (arrival !== undefined && !PLAYED.has(id) ? arrival : null));
  /* With reduced motion nothing slides, so no animation will ever end to switch this off. */
  const [sliding, setSliding] = useState(() => (mode?.slide ?? false) && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const [lit, setLit] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  /* The slide's clipping comes off once it has landed: on a timer rather than animationend, which a
     page in the background never fires. */
  useEffect(() => {
    if (!sliding || mode === null) return;
    const done = setTimeout(() => setSliding(false), mode.delay + SLIDE_MS + 50);
    return () => clearTimeout(done);
  }, [sliding, mode]);

  useEffect(() => {
    if (mode === null) return;
    PLAYED.add(id);
    const el = box.current;
    if (el === null || typeof IntersectionObserver === 'undefined') {
      setLit(true);
      return;
    }
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setLit(true);
        seen.disconnect();
      }
    });
    seen.observe(el);
    return () => seen.disconnect();
  }, [mode, id]);

  const attrs = { [LIVE_ID_ATTR]: id };
  const style = mode !== null ? ({ '--live-delay': `${mode.delay}ms` } as CSSProperties) : undefined;
  const cls = [styles['live'], sliding ? styles['slide'] : '', lit ? styles['lit'] : ''].filter(Boolean).join(' ');
  return (
    <div ref={box} className={cls} style={style} {...attrs}>
      <div className={styles['inner']}>
        {children}
      </div>
    </div>
  );
}
