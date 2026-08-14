/**
 * THE LIVE RAIL — the permanent right column.
 *
 * Hawa's rail is not a drawer and there is no control to dismiss it: "main-left + permanent
 * live feed right (never hides)". It is part of the shell's grid, and it leaves only when the
 * viewport is too narrow to hold it (≤1040px, in rail.module.css).
 *
 * Nothing is ingesting yet. So the rail is fully built — header, mode tabs, scroller, card
 * shell — and completely honest: the live pip does not pulse, the status pill does not say
 * "feed live", the count is a dash rather than a zero, and each mode says in one line what
 * has to exist before it can show anything. No placeholder rows, no skeleton that never
 * resolves, no invented trades.
 */

import { useState } from 'react';

import styles from './rail.module.css';

type RailMode = 'trades' | 'launches' | 'viral';

interface Mode {
  readonly id: RailMode;
  readonly label: string;
  /** The rail header title for this mode. Hers reads "Live viral feed"; nothing is live. */
  readonly title: string;
  /** What this mode shows, in the present tense. */
  readonly shows: string;
  /** What has to exist first. One sentence, no roadmap. */
  readonly needs: string;
}

const MODES: readonly Mode[] = [
  {
    id: 'trades',
    label: 'Trades',
    title: 'Trades',
    shows: 'Fills as they land, newest first.',
    needs: 'Needs a trade feed. Nothing is streaming fills yet, so there is nothing to show.',
  },
  {
    id: 'launches',
    label: 'Launches',
    title: 'New launches',
    shows: 'Coins as they are minted.',
    needs: 'Needs a mint feed. Nothing is watching for new coins yet, so there is nothing to show.',
  },
  {
    id: 'viral',
    label: 'Viral',
    title: 'Viral feed',
    shows: 'Posts as they spread.',
    needs: 'Needs a post feed. Nothing is ingesting posts yet, so there is nothing to show.',
  },
];

/* Her markup opens on Viral. */
const DEFAULT_MODE: RailMode = 'viral';

export function LiveRail() {
  const [mode, setMode] = useState<RailMode>(DEFAULT_MODE);
  const current = MODES.find((m) => m.id === mode) ?? MODES[MODES.length - 1];

  return (
    <aside className={styles['rail']} aria-label="live activity">
      <div className={styles['hd']}>
        {/* The pip is off, not pulsing. See rail.module.css. */}
        <span className={`${styles['lz']} ${styles['lzOff']}`} />
        <span className={styles['t']}>{current?.title ?? 'Live activity'}</span>
        <span className={styles['status']} title="No ingest is connected">
          no ingest
        </span>
        {/* An absent count is a dash, never 0 — 0 would read as "nothing happened". */}
        <span className={styles['count']}>—</span>
      </div>

      <div className={styles['tabs']} role="tablist" aria-label="live feed mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={m.id === mode}
            className={`${styles['tab']} ${m.id === mode ? styles['tabOn'] : ''}`}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className={styles['stream']}>
        {/* One real card, in her card chrome, carrying the truth. The shape is on screen and
            correct; nothing on it is invented. */}
        <div className={styles['card']}>
          <div className={styles['cardTitle']}>{current?.shows ?? ''}</div>
          <div className={styles['cardText']}>{current?.needs ?? ''}</div>
          <span className={styles['cardNote']}>
            When the feed is connected, items arrive here newest-first and this card goes away.
          </span>
        </div>
      </div>
    </aside>
  );
}
