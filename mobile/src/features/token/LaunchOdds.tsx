/**
 * WHAT SIMILAR LAUNCHES DID, ON A TOKEN PAGE (the owner, 2026-10-30; references
 * reports/mockups/odds-9-top-line-close.png and odds-6-clean.jpg). Two additions and nothing else changed:
 *
 *   OddsLine     one plain line under the address row, no box: "Strong" (or no word), then 2x, 10x, Rug and
 *                Peak with their values, a chevron at the end. Values green by the same rule as the table.
 *                Tapping it opens the Info tab.
 *   LaunchOdds   the top of the Info tab: "Similar launches" with a verdict pill (Strong, or Rug risk only
 *                when a group earned red), the group in one line, a card of THIS COIN against USUAL measured
 *                from the price at the latest moment the coin has reached (minute 5, else minute 1, else
 *                second 1), a Wallets card of six cells, and the footnote.
 *
 * ★ FACTS ABOUT OTHER LAUNCHES, NEVER A CALL ON THIS ONE. Every share is of past launches that opened like
 * this one, measured from the price at that moment; the coin's own numbers are what it did. Colour only where
 * a value is clearly better (green) or worse (red) than usual; everything else is white or grey.
 * ★ A SLOW RUN AND THE PEAK TIMES need a day of trades per past launch (2x first reached after the hour; the
 * day's peak, usual and slowest one in four); until the backfill's day reads have run they are a dash that
 * says so, and the line's Peak is a dash.
 * ★ AN ABSENCE SAYS WHY. A coin whose first second we did not see, or history not built, shows the heading
 * and that sentence; a wallet fact not recorded live is a dash with "Not recorded yet". Never a zero.
 *
 * What breaks if changed carelessly: the moment. The line, the header cell and the subline must all name the
 * same moment (`latest`), or the line quotes one moment's history and the card another's.
 */

import type { CoinOdds, MomentOdds, OddsMoment, OddsShares } from '../../shared/api/index.ts';
import { ChevronIcon } from '../../shared/ui/icons.tsx';
import { better, peakAbout, peakText, sharePercent } from './odds-view.ts';
import styles from './odds.module.css';

const FROM: Record<OddsMoment, string> = { second_1: 'From sec 1 price', minute_1: 'From min 1 price', minute_5: 'From min 5 price' };

const WHY_TEXT = {
  not_seen: 'We did not see this coin’s first second of trading, so we cannot say which launches it is like.',
  not_built: 'Not ready yet.',
} as const;

/** The latest moment the coin has reached. */
function latest(odds: CoinOdds): MomentOdds | null {
  if (odds.kind !== 'odds') return null;
  return odds.moments.find((m) => m.at === odds.at) ?? odds.moments[odds.moments.length - 1] ?? null;
}

const hitOf = (s: OddsShares, x: number): number | null => s.hit.find((h) => h.x === x)?.share ?? null;

/** The line under the address row. Nothing while loading, for another venue, or when too few launches. */
export function OddsLine({ odds, onOpen }: { odds: CoinOdds | null; onOpen: () => void }) {
  const m = odds === null ? null : latest(odds);
  if (m === null || m.look === 'early') return null;
  const v = (mine: number | null, usual: number | null, moreIsGood: boolean, shown: string) => (
    <b className={styles[better(mine, usual, moreIsGood)] ?? ''}>{shown}</b>
  );
  const two = hitOf(m.like, 2);
  const ten = hitOf(m.like, 10);
  return (
    <button type="button" className={styles['line']} onClick={onOpen} aria-label="Similar launches, open Info">
      {m.look === 'runner' ? <span className={styles['good']}>Strong</span> : null}
      <span>2x {v(two, hitOf(m.normal, 2), true, sharePercent(two))}</span>
      <span>10x {v(ten, hitOf(m.normal, 10), true, sharePercent(ten))}</span>
      <span>Rug {v(m.like.rugged, m.normal.rugged, false, sharePercent(m.like.rugged))}</span>
      <span>Peak <b>{peakAbout(m.like.peakP50S)}</b></span>
      <span className={styles['lineEnd']} aria-hidden="true"><ChevronIcon size={14} /></span>
    </button>
  );
}

function subline(m: MomentOdds, days: number): string {
  const n = m.like.launches.toLocaleString('en-US');
  if (!m.held) return `No different from all ${n} launches, last ${days} days`;
  if (m.at === 'second_1') return `${n} launches that opened like this, last ${days} days`;
  return `${n} launches as busy as this by minute ${m.at === 'minute_1' ? '1' : '5'}, last ${days} days`;
}

export function LaunchOdds({ odds }: { odds: CoinOdds | null }) {
  if (odds === null) return null;
  if (odds.kind === 'none') {
    if (odds.why === 'not_launchpad') return null;
    return (
      <section className={styles['odds']} aria-label="Similar launches">
        <h3 className={styles['title']}>Similar launches</h3>
        <p className={styles['sub']}>{WHY_TEXT[odds.why]}</p>
      </section>
    );
  }
  const m = latest(odds);
  if (m === null) return null;
  const pill = m.look === 'runner' ? <span className={`${styles['pill']} ${styles['good']}`}>Strong</span> : m.look === 'rug' ? <span className={`${styles['pill']} ${styles['bad']}`}>Rug risk</span> : null;
  const like = m.like;
  const usual = m.normal;
  const row = (label: string, mine: number | null, avg: number | null, moreIsGood: boolean, show: (v: number | null) => string = sharePercent) => (
    <div className={styles['row']}>
      <span className={styles['rowLabel']}>{label}</span>
      <span className={`${styles['num']} ${styles[better(mine, avg, moreIsGood)] ?? ''}`}>{show(mine)}</span>
      <span className={`${styles['num']} ${styles['usual']}`}>{show(avg)}</span>
    </div>
  );
  /* A peak time is measured out to a day from the backfill's day reads; until then, a dash that says so. */
  const timeRow = (label: string, mine: number | null, avg: number | null) => (
    <div className={styles['row']}>
      <span className={styles['rowLabel']}>
        {label}
        {mine === null && avg === null ? <span className={styles['why']}>Not measured yet</span> : null}
      </span>
      <span className={styles['num']}>{peakText(mine)}</span>
      <span className={`${styles['num']} ${styles['usual']}`}>{peakText(avg)}</span>
    </div>
  );
  return (
    <section className={styles['odds']} aria-label="Similar launches">
      <div className={styles['head']}>
        <h3 className={styles['title']}>Similar launches</h3>
        {pill}
      </div>
      <p className={styles['sub']}>{subline(m, odds.days)}</p>
      {m.look === 'early' ? (
        <p className={styles['sub']}>Too few launches opened like this one to tell what usually happens next.</p>
      ) : (
        <div className={styles['card']}>
          <div className={`${styles['row']} ${styles['th']}`}>
            <span>{FROM[m.at]}</span>
            <span className={styles['right']}>This coin</span>
            <span className={styles['right']}>Usual</span>
          </div>
          {row('Reach 2x', hitOf(like, 2), hitOf(usual, 2), true)}
          {row('Reach 5x', hitOf(like, 5), hitOf(usual, 5), true)}
          {row('Reach 10x', hitOf(like, 10), hitOf(usual, 10), true)}
          {like.slow2x === null ? (
            <div className={styles['row']}>
              <span className={styles['rowLabel']}>
                Slow run, 2x after 1h
                <span className={styles['why']}>Not measured yet</span>
              </span>
              <span className={styles['num']}>—</span>
              <span className={`${styles['num']} ${styles['usual']}`}>—</span>
            </div>
          ) : (
            row('Slow run, 2x after 1h', like.slow2x, usual.slow2x, true)
          )}
          {row('Rug within 1h', like.rugged, usual.rugged, false)}
          {row('Never moved', like.neverMoved, usual.neverMoved, false)}
          {timeRow('Usual peak time', like.peakP50S, usual.peakP50S)}
          {timeRow('Slowest 1 in 4 peak', like.peakP75S, usual.peakP75S)}
        </div>
      )}

      {odds.wallets.length > 0 ? (
        <>
          <h3 className={`${styles['title']} ${styles['second']}`}>Wallets</h3>
          <dl className={styles['stats']}>
            {odds.wallets.map((w) => (
              <div key={w.label} className={styles['stat']}>
                <dt>{w.label}</dt>
                <dd className={`${styles['num']} ${styles[w.tone] ?? ''}`}>{w.value}</dd>
                <dd className={styles['note']}>{w.note}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}

      <p className={styles['foot']}>Past outcomes of similar launches, not a forecast.</p>
    </section>
  );
}
