/**
 * MONEY IN THE NUMBER FACE. Every money value, price, market cap, multiple and percentage change
 * on screen is set in the mono number font (tokens.css --font-mono), so figures line up and read as
 * figures (the owner's type scale, 2026-10-22). `Num` is for a span that holds only a figure;
 * `Nums` is for a sentence the app writes with a figure inside ("$ISAAC $3.4K market cap", "at $12K
 * market cap"), and sets only the money, percentage and multiple tokens in it, never counts like
 * "2 posts" or "1 coin".
 *
 * Separate from Value.tsx because many figures are not Measured (a scrubbed chart value, a +12%
 * change) and because a sentence needs splitting, which Value never does.
 *
 * What breaks if changed carelessly: the pattern. Widen it to bare numbers and every count on
 * screen turns mono; narrow it and a "$" figure inside a sentence falls back to the body face. The
 * coin page's top half and the Buy and Sell pop-ups do not use these on purpose (left as they are).
 */

import type { ReactNode } from 'react';
import styles from './ui.module.css';

export function Num({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <span className={`${styles['num']} ${className ?? ''}`}>{children}</span>;
}

/** A dollar figure, a percentage (signed or not) or a multiple like 2x or 10x. */
const FIGURE = /([+\-−]?\$[\d.,]+[KMBT]?|[+\-−]?[\d.,]*\d%|\b\d+(?:\.\d+)?x\b)/;

export function Nums({ text }: { text: string }) {
  const parts = text.split(FIGURE);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <span key={i} className={styles['num']}>{p}</span> : p))}
    </>
  );
}
