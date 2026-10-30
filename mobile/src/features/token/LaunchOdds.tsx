/**
 * THE LAUNCH PROFILE ON A TOKEN PAGE (the owner, 2026-10-30: the odds and the rug risk at a glance; layout
 * reports/mockups/token-pro.html). Two pieces from one read (shared/api/odds.ts):
 *
 *   OddsSummary   one row under the price: a status dot, "Launch profile", "Strong  10x in 16% of
 *                 comparable launches", and a chevron that opens the Info tab.
 *   LaunchOdds    the Info tab's "Comparable launches": how many launches over how many days; Second 1 /
 *                 Minute 1 / Minute 5 for the moments the coin has reached; a table of 2x/3x/5x/10x with a
 *                 thin bar and a grey tick at the average launch, the share reached and its multiple of the
 *                 average; "Risk" (rugged within an hour, with its definition; never moved; time to peak)
 *                 each against all launches; "On-chain signals", the coin's own opening facts with how
 *                 launches like it did and a coloured word; and the footnote.
 *
 * ★ FACTS ABOUT OTHER LAUNCHES, NEVER A CALL ON THIS ONE. Every figure is a share of past launches measured
 * from the price at the chosen moment, and every sentence about a group comes from the read service
 * (launch-odds.ts). Colour is spent only on good and bad: green where launches like it did better than
 * average, red where worse, amber for a rug sign's neighbour words; everything else is grey.
 * ★ AN ABSENCE SAYS WHY. A coin whose first second we did not see, or a profile not yet built, shows the
 * section with that sentence and no summary row; another venue's coin has neither. A share not sent is a dash.
 *
 * What breaks if changed carelessly: the bar scale. Bars are drawn against the largest share in the table,
 * so 3% beside 1% is visible; the percentage is printed in its own column so the bar never stands in for it.
 */

import { useState, type ReactNode } from 'react';

import type { CoinOdds, OddsLook, OddsMoment, OddsShares, OddsSignal } from '../../shared/api/index.ts';
import { CandleIcon, ChevronIcon, CoinIcon, LineChartIcon, TrendingUpIcon, UserIcon } from '../../shared/ui/icons.tsx';
import { peakText, sharePercent, timesText } from './odds-view.ts';
import styles from './odds.module.css';

const LOOK_WORD: Record<OddsLook, string> = {
  runner: 'Strong',
  mixed: 'Mixed',
  rug: 'Rug signs',
  dead: 'Mostly dead',
  early: 'Too early to tell',
};
const LOOK_TONE: Record<OddsLook, string> = { runner: 'good', mixed: 'warn', rug: 'bad', dead: 'quiet', early: 'quiet' };
const MOMENT_LABEL: Record<OddsMoment, string> = { second_1: 'Second 1', minute_1: 'Minute 1', minute_5: 'Minute 5' };

const WHY_TEXT = {
  not_seen: 'We did not see this coin’s first second of trading, so we cannot say which launches it is like.',
  not_built: 'The launch profile is not ready yet.',
} as const;

/** The row under the price. Nothing when there is no profile to sum up. */
export function OddsSummary({ odds, onOpen }: { odds: CoinOdds | null; onOpen: () => void }) {
  if (odds === null || odds.kind !== 'odds') return null;
  const m = odds.moments.find((x) => x.at === odds.at) ?? odds.moments[odds.moments.length - 1];
  if (m === undefined) return null;
  const ten = m.like.hit.find((h) => h.x === 10)?.share ?? null;
  return (
    <button type="button" className={styles['profile']} onClick={onOpen} aria-label="Launch profile, open Info">
      <span className={`${styles['dot']} ${styles[LOOK_TONE[m.look]] ?? ''}`} aria-hidden="true" />
      <span className={styles['profileText']}>
        <span className={styles['profileLabel']}>Launch profile</span>
        <span className={styles['profileValue']}>
          {LOOK_WORD[m.look]}
          {m.look !== 'early' && ten !== null ? (
            <>
              <span className={styles['gap']} />
              10x in {sharePercent(ten)} of comparable launches
            </>
          ) : null}
        </span>
      </span>
      <ChevronIcon size={16} />
    </button>
  );
}

export function LaunchOdds({ odds }: { odds: CoinOdds | null }) {
  const [picked, setPicked] = useState<OddsMoment | null>(null);
  if (odds === null) return null;
  if (odds.kind === 'none') {
    if (odds.why === 'not_launchpad') return null;
    return (
      <section className={styles['section']} aria-label="Comparable launches">
        <Head title="Comparable launches" />
        <p className={styles['note']}>{WHY_TEXT[odds.why]}</p>
      </section>
    );
  }
  const m = odds.moments.find((x) => x.at === (picked ?? odds.at)) ?? odds.moments[odds.moments.length - 1];
  if (m === undefined) return null;
  return (
    <>
      <section className={styles['section']} aria-label="Comparable launches">
        <Head title="Comparable launches" aside={`${m.like.launches.toLocaleString('en-US')} launches   ${odds.days} days`} />
        <div className={styles['segment']} role="tablist" aria-label="Measured from">
          {(['second_1', 'minute_1', 'minute_5'] as const).map((at) => {
            const has = odds.moments.some((x) => x.at === at);
            return has ? (
              <button key={at} type="button" role="tab" aria-selected={at === m.at} className={at === m.at ? styles['segmentOn'] : ''} onClick={() => setPicked(at)}>
                {MOMENT_LABEL[at]}
              </button>
            ) : (
              <span key={at} className={styles['segmentLater']}>{MOMENT_LABEL[at]}</span>
            );
          })}
        </div>
        <p className={styles['group']}>
          <span className={`${styles['look']} ${styles[LOOK_TONE[m.look]] ?? ''}`}>{LOOK_WORD[m.look]}</span>
          <span className={styles['gap']} />
          {m.group}
        </p>
        {m.look === 'early' ? <p className={styles['note']}>Too few launches opened like this one to tell what usually happens next.</p> : <Targets like={m.like} normal={m.normal} />}
      </section>

      {m.look !== 'early' ? <Risk like={m.like} normal={m.normal} /> : null}
      {m.signals.length > 0 ? <Signals signals={m.signals} /> : null}

      <p className={styles['foot']}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
        <span>Based on launches with a similar opening over the last {odds.days} days, measured from the price at the selected time. Past outcomes, not a forecast.</span>
      </p>
    </>
  );
}

function Head({ title, aside = null }: { title: string; aside?: string | null }) {
  return (
    <div className={styles['head']}>
      <h3 className={styles['title']}>{title}</h3>
      {aside !== null ? <span className={styles['aside']}>{aside}</span> : null}
    </div>
  );
}

/** Better or worse than average, for a share where more is good (`up`) or bad. */
function against(v: number | null, avg: number | null, moreIsGood: boolean): { word: string; tone: string } {
  if (v === null || avg === null || avg <= 0) return { word: '', tone: 'quiet' };
  const r = v / avg;
  if (r >= 1.1) return { word: 'Higher', tone: moreIsGood ? 'good' : 'bad' };
  if (r <= 0.9) return { word: 'Lower', tone: moreIsGood ? 'bad' : 'good' };
  return { word: 'About', tone: 'quiet' };
}

function Targets({ like, normal }: { like: OddsShares; normal: OddsShares }) {
  const top = Math.max(0.0001, ...like.hit.map((h) => h.share), ...normal.hit.map((h) => h.share));
  return (
    <div className={styles['table']}>
      <div className={styles['th']}>
        <span>Target</span>
        <span />
        <span className={styles['r']}>Reached</span>
        <span className={styles['r']}>vs avg</span>
      </div>
      {like.hit.map((h) => {
        const n = normal.hit.find((x) => x.x === h.x)?.share ?? null;
        const vs = against(h.share, n, true);
        return (
          <div key={h.x} className={styles['tr']}>
            <span className={styles['b']}>{h.x}×</span>
            <span className={styles['track']}>
              <span className={styles['fill']} style={{ width: `${(h.share / top) * 100}%` }} />
              {n !== null ? <span className={styles['tick']} style={{ left: `${(n / top) * 100}%` }} aria-hidden="true" /> : null}
            </span>
            <span className={`${styles['r']} ${styles['b']}`}>{sharePercent(h.share)}</span>
            <span className={styles['r']}>
              <span className={`${styles['times']} ${styles[vs.tone] ?? ''}`}>{timesText(h.share, n)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Risk({ like, normal }: { like: OddsShares; normal: OddsShares }) {
  const rug = against(like.rugged, normal.rugged, false);
  const still = against(like.neverMoved, normal.neverMoved, false);
  return (
    <section className={styles['section']} aria-label="Risk">
      <Head title="Risk" aside="vs all launches" />
      <div className={styles['list']}>
        <Item title="Rugged within 1 hour" sub="Rose 50%, then gave back 90% of the rise" value={sharePercent(like.rugged)}>
          <span className={styles[rug.tone]}>{rug.word}<span className={styles['gap']} />avg {sharePercent(normal.rugged)}</span>
        </Item>
        <Item title="Never moved" sub="Never 10% above the price at that time" value={sharePercent(like.neverMoved)}>
          <span className={styles[still.tone]}>{still.word}<span className={styles['gap']} />avg {sharePercent(normal.neverMoved)}</span>
        </Item>
        <Item title="Time to peak" sub="Median, for launches that doubled, within the hour" value={peakText(like.halfPeakS)}>
          <span className={styles['quiet']}>avg {peakText(normal.halfPeakS)}</span>
        </Item>
      </div>
    </section>
  );
}

const SIGNAL_ICON: Record<string, () => ReactNode> = {
  'First-second buyers': () => <UserIcon size={15} />,
  'First-second buys': () => <TrendingUpIcon size={15} />,
  'Developer buy': () => <CoinIcon size={15} />,
  'Move since first trade': () => <LineChartIcon size={15} />,
};
const QUALIFIER_TONE = { Strong: 'good', Typical: 'quiet', 'Rug sign': 'bad' } as const;

function Signals({ signals }: { signals: readonly OddsSignal[] }) {
  return (
    <section className={styles['section']} aria-label="On-chain signals">
      <Head title="On-chain signals" aside="Recorded at launch" />
      <div className={styles['list']}>
        {signals.map((s) => (
          <SignalRow key={s.label} s={s} />
        ))}
      </div>
    </section>
  );
}

function SignalRow({ s }: { s: OddsSignal }) {
  const [open, setOpen] = useState(false);
  const tone = QUALIFIER_TONE[s.qualifier];
  return (
    <button type="button" className={styles['itemButton']} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
      <span className={styles['item']}>
        <span className={`${styles['icon']} ${styles[tone] ?? ''}`}>{(SIGNAL_ICON[s.label] ?? (() => <CandleIcon size={15} />))()}</span>
        <span className={styles['itemText']}>
          <span className={styles['itemTitle']}>{s.label}</span>
          <span className={styles['itemSub']}>{s.context}</span>
        </span>
        <span className={styles['itemValue']}>
          <b>{s.value}</b>
          <span className={styles[tone]}>{s.qualifier}</span>
        </span>
      </span>
      {open ? <span className={styles['explain']}>{s.explain}</span> : null}
    </button>
  );
}

function Item({ title, sub, value, children }: { title: string; sub: string; value: string; children: ReactNode }) {
  return (
    <div className={styles['item']}>
      <span className={styles['itemText']}>
        <span className={styles['itemTitle']}>{title}</span>
        <span className={styles['itemSub']}>{sub}</span>
      </span>
      <span className={styles['itemValue']}>
        <b>{value}</b>
        {children}
      </span>
    </div>
  );
}
