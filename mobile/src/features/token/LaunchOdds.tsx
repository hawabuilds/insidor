/**
 * THE INFO TAB'S LAUNCH HISTORY BLOCK (the owner, 2026-10-30: the odds and the rug risk at a glance). What
 * happened to past launches that opened like this one, beside what happened to all launches: one colour
 * chip, "Hit at least" bars for 2x/3x/5x/10x with all launches' rate marked on each, the rugged and
 * never-moved rows, how many launches it rests on, and up to four of the coin's own opening facts as badges,
 * worst first, each opening to the sentence it stands for on a tap.
 *
 * ★ FACTS ABOUT OTHER LAUNCHES, NEVER A CALL ON THIS ONE. Every word of the history comes from the read
 * service (launch-odds.ts), which words it as history ("Launches that opened like this one, last 30 days");
 * this file draws it and adds nothing that reads as a prediction. The chip names what the history looks
 * like — "Rug signs" whenever any badge is red, whatever else — never what the coin will do.
 * ★ AN ABSENCE SAYS WHY. A coin whose first second we did not see, or history not yet built, shows the block
 * with that sentence; another venue's coin has no block at all. A share the server did not send is a dash.
 *
 * Its own file beside InfoPanel.tsx because the block has its own read and its own tap state; the panel
 * stays a list of facts. What breaks if changed carelessly: the bar scale. Bars are drawn against the
 * largest share in the block, so a 3% next to a 1% is visible; the percentages are printed beside every bar
 * so the scale never stands in for the number.
 */

import { useState } from 'react';

import type { CoinOdds, OddsBadge, OddsLook, OddsShares } from '../../shared/api/index.ts';
import { sharePercent } from './odds-view.ts';
import styles from './odds.module.css';

const LOOK_LABEL: Record<OddsLook, string> = {
  runner: 'Runner odds',
  mixed: 'Mixed',
  rug: 'Rug signs',
  dead: 'Mostly dead',
  early: 'Too early to tell',
};

const WHY_TEXT = {
  not_seen: 'We did not see this coin’s first second of trading, so we cannot say which launches it is like.',
  not_built: 'Launch history is not ready yet.',
} as const;

export function LaunchOdds({ odds }: { odds: CoinOdds | null }) {
  if (odds === null) return null;
  if (odds.kind === 'none') {
    if (odds.why === 'not_launchpad') return null;
    return (
      <section className={styles['odds']} aria-label="Launch history">
        <h3 className={styles['title']}>Launch history</h3>
        <p className={styles['note']}>{WHY_TEXT[odds.why]}</p>
      </section>
    );
  }
  const early = odds.look === 'early';
  return (
    <section className={styles['odds']} aria-label="Launch history">
      <div className={styles['head']}>
        <h3 className={styles['title']}>Launch history</h3>
        <span className={`${styles['chip']} ${styles[odds.look] ?? ''}`}>{LOOK_LABEL[odds.look]}</span>
      </div>
      <p className={styles['headline']}>{odds.headline}</p>
      <p className={styles['note']}>
        {odds.group}
        <span className={styles['gap']} />
        based on {odds.like.launches.toLocaleString('en-US')} launches
      </p>
      {early ? (
        <p className={styles['note']}>Too few launches opened like this one to tell what usually happens next.</p>
      ) : (
        <Bars like={odds.like} normal={odds.normal} />
      )}
      {odds.badges.length > 0 ? (
        <ul className={styles['badges']}>
          {odds.badges.map((b) => (
            <Badge key={`${b.tone}:${b.fact}`} badge={b} />
          ))}
        </ul>
      ) : null}
      <p className={styles['foot']}>Measured from the price at that moment, over each launch’s first hour, last {odds.days} days.</p>
    </section>
  );
}

function Bars({ like, normal }: { like: OddsShares; normal: OddsShares }) {
  const top = Math.max(0.0001, ...like.hit.map((h) => h.share), ...normal.hit.map((h) => h.share));
  return (
    <div className={styles['card']}>
      <div className={styles['kicker']}>Hit at least</div>
      {like.hit.map((h) => {
        const n = normal.hit.find((x) => x.x === h.x)?.share ?? null;
        return (
          <div key={h.x} className={styles['bar']}>
            <span className={styles['barLabel']}>{h.x}x</span>
            <span className={styles['track']}>
              <span className={styles['fill']} style={{ width: `${(h.share / top) * 100}%` }} />
              {n !== null ? <span className={styles['marker']} style={{ left: `${(n / top) * 100}%` }} aria-hidden="true" /> : null}
            </span>
            <span className={styles['barValue']}>{sharePercent(h.share)}</span>
          </div>
        );
      })}
      <div className={styles['legend']}>
        <span className={styles['legendMark']} aria-hidden="true" /> all launches
      </div>
      <div className={styles['row']}>
        <span className={styles['rowLabel']}>Rugged within 1h</span>
        <span className={styles['rowValue']}>
          <b>{sharePercent(like.rugged)}</b> <span className={styles['vs']}>vs {sharePercent(normal.rugged)} of all</span>
        </span>
      </div>
      <div className={styles['row']}>
        <span className={styles['rowLabel']}>Never moved</span>
        <span className={styles['rowValue']}>
          <b>{sharePercent(like.neverMoved)}</b> <span className={styles['vs']}>vs {sharePercent(normal.neverMoved)} of all</span>
        </span>
      </div>
    </div>
  );
}

function Badge({ badge }: { badge: OddsBadge }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button type="button" className={`${styles['badge']} ${styles[badge.tone] ?? ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={styles['dot']} aria-hidden="true" />
        <span className={styles['badgeText']}>
          <b>{badge.fact}</b>
          <span className={styles['vs']}>{badge.compare}</span>
        </span>
      </button>
      {open ? <p className={styles['explain']}>{badge.explain}</p> : null}
    </li>
  );
}
