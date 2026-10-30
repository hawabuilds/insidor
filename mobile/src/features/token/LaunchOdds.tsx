/**
 * WHAT SIMILAR LAUNCHES DID, ON A TOKEN PAGE (the owner, 2026-10-30; reference
 * reports/mockups/odds-1-top.jpg and odds-5-one-column.jpg). Two additions and nothing else changed:
 *
 *   OddsChip     one chip in the page's existing chips row, the same size as its neighbours: "16% reach
 *                10x ›" in green when similar launches did clearly better than usual, "27% rug within 1h ›"
 *                in red on a rug sign, plain otherwise. It opens the Info tab.
 *   LaunchOdds   the top of the Info tab: "Similar launches" with a verdict pill (Strong, or Rug risk only
 *                when a group earned red), the group in one line, a card of THIS COIN against USUAL measured
 *                from the price at the latest moment the coin has reached (minute 5, else minute 1, else
 *                second 1), a Wallets card of six cells, and the footnote.
 *
 * ★ FACTS ABOUT OTHER LAUNCHES, NEVER A CALL ON THIS ONE. Every share is of past launches that opened like
 * this one, measured from the price at that moment; the coin's own numbers are what it did. Colour only where
 * a value is clearly better (green) or worse (red) than usual; everything else is white or grey.
 * ★ A SLOW RUN needs a day of trades per past launch (2x first reached after the hour, within a day); until
 * the backfill's day reads have run, its row is a dash that says so.
 * ★ AN ABSENCE SAYS WHY. A coin whose first second we did not see, or history not built, shows the heading
 * and that sentence; a wallet fact not recorded live is a dash with "Not recorded yet". Never a zero.
 *
 * What breaks if changed carelessly: the moment. The chip, the header cell and the subline must all name the
 * same moment (`latest`), or the chip quotes one moment's history and the card another's.
 */

import type { CoinOdds, MomentOdds, OddsMoment, OddsShares } from '../../shared/api/index.ts';
import { better, peakText, sharePercent } from './odds-view.ts';
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

/** The chip in the page's chips row. Nothing while loading, for another venue, or when too few launches. */
export function OddsChip({ odds, className, onOpen }: { odds: CoinOdds | null; className: string | undefined; onOpen: () => void }) {
  const m = odds === null ? null : latest(odds);
  if (m === null || m.look === 'early') return null;
  const rug = m.look === 'rug';
  const text = rug ? `${sharePercent(m.like.rugged)} rug within 1h ›` : `${sharePercent(hitOf(m.like, 10))} reach 10x ›`;
  const tone = rug ? styles['chipBad'] : m.look === 'runner' ? styles['chipGood'] : '';
  return (
    <button type="button" className={`${className ?? ''} ${tone ?? ''}`} onClick={onOpen} aria-label={`Similar launches: ${text.slice(0, -2)}. Open Info`}>
      {text}
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
          <div className={styles['row']}>
            <span className={styles['rowLabel']}>Time to peak</span>
            <span className={styles['num']}>{peakText(like.halfPeakS)}</span>
            <span className={`${styles['num']} ${styles['usual']}`}>{peakText(usual.halfPeakS)}</span>
          </div>
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
