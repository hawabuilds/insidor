/**
 * THE FEED TAB'S CALLS — Insidor's own track record (the owner, 2026-11-13: "not for traders, it's to
 * see the calls Insidor has made and its x's"), every multiple measured from the market cap we told
 * people (2026-11-14), laid out as a premium money app's portfolio screen (the owner, same day):
 *
 *   Week / Month / All time   a full-width segmented control, the app's segment track
 *   the headline card         "Best call this week", the best multiple large and green, its coin and
 *                             money line; a hairline; the calls, 2x or more, 10x or more
 *   the list                  one card, rows split by hairlines: the place, the coin's logo and
 *                             ticker, "Notified 3m after launch", "$12K → $1.2M"; at the right the
 *                             multiple in a green pill (grey when it never rose). The whole row opens
 *                             the coin's token page and its chart.
 *
 * ★ FACTS ONLY. The server orders the rows and counts the record; every number is the cap we told
 * people or a price the coin traded at. A call it could not price shows a quiet dash and its reason
 * ("Price not recorded", or "Little money traded" for a thin pool's price), never 0x or 1x, has no
 * place, and still counts. While the server is still counting (its first pass after a start) the
 * screen says so with skeletons and asks again.
 *
 * The type is the app's one scale (tokens.css): words in Inter, every figure in the number face
 * (Num.tsx); the headline multiple is the one size above the scale, as a balance is on a money app's
 * home. Green is price direction only (rule 1): an up multiple's pill and the headline.
 *
 * What breaks if changed carelessly: re-sorting or re-counting here. The ranking and the record are
 * the server's, so every phone shows the same record.
 */

import { useEffect, useState } from 'react';

import { fetchCalls, type CallRow, type CallsWindow } from '../../shared/api/index.ts';
import { useLoad } from '../../shared/hooks.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { Num } from '../../shared/ui/Num.tsx';
import alerts from '../alerts/alerts.module.css';
import { bestLabel, missingLine, moneyLine, multipleText, notifiedLine, recordCells } from './calls-words.ts';
import { coinHref } from './lines.ts';
import styles from './following.module.css';

const WINDOWS: readonly { readonly key: CallsWindow; readonly label: string }[] = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All time' },
];

/** How soon to ask again while the server is still counting. */
const COUNTING_RETRY_MS = 4_000;
const LOGO = 36;
const HERO_LOGO = 20;

export function CallsList() {
  const [span, setSpan] = useState<CallsWindow>('week');
  const [calls, reload] = useLoad(`calls:${span}`, (signal) => fetchCalls(span, signal), 'memory');
  const counting = calls.state === 'ready' && calls.value.state === 'counting';

  /* Asked again after every "counting" answer, not once: each answer is a new result, so the timer is
     set again until the list is ready. */
  useEffect(() => {
    if (!counting) return;
    const t = setTimeout(reload, COUNTING_RETRY_MS);
    return () => clearTimeout(t);
  }, [calls, counting, reload]);

  const board = calls.state === 'ready' && calls.value.state === 'ready' ? calls.value : null;
  const best = board?.rows[0]?.multiple != null ? board.rows[0] : null;

  return (
    <>
      <div className={styles['segment']} role="group" aria-label="Calls over">
        {WINDOWS.map((w) => (
          <button key={w.key} type="button" aria-pressed={w.key === span} className={w.key === span ? styles['segmentOn'] : ''} onClick={() => setSpan(w.key)}>
            {w.label}
          </button>
        ))}
      </div>
      {calls.state === 'loading' || counting ? <Counting /> : null}
      {calls.state === 'failed' ? <p className={alerts['centred']}>Insidor's calls couldn't be read just now. Pull down to try again.</p> : null}
      {board !== null ? (
        <>
          <section className={styles['hero']} aria-label={bestLabel(span)}>
            <div className={styles['heroEyebrow']}>{bestLabel(span)}</div>
            {best !== null ? (
              <a className={styles['heroBest']} href={coinHref(best.address)}>
                <Num className={styles['heroMultiple']}>{multipleText(best.multiple!)}</Num>
                <span className={styles['heroCoin']}>
                  <CoinLogo small address={best.address} ticker={best.ticker} imageUrl={best.imageUrl} size={HERO_LOGO} />
                  <span className={styles['heroTicker']}>{best.ticker === null ? '—' : `$${best.ticker}`}</span>
                  {moneyLine(best) !== null ? <Num className={styles['heroMoney']}>{moneyLine(best)}</Num> : null}
                </span>
              </a>
            ) : (
              <div className={styles['heroEmpty']}>—</div>
            )}
            <div className={styles['heroStats']}>
              {recordCells(board.record).map((c) => (
                <div key={c.label} className={styles['heroStat']}>
                  <Num className={styles['heroStatValue']}>{c.value}</Num>
                  <div className={styles['heroStatLabel']}>{c.label}</div>
                </div>
              ))}
            </div>
          </section>

          {board.rows.length === 0 ? (
            <div className={alerts['emptyBox']}>
              <p className={alerts['emptyText']}>{span === 'week' ? 'No calls this week yet.' : 'No calls yet.'}</p>
              {span === 'week' ? (
                <button type="button" className={alerts['emptyAction']} onClick={() => setSpan('all')}>
                  See all time
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className={styles['listHead']}>
                <span>Ranked by how far it ran</span>
                <span>From the notified cap</span>
              </div>
              <ol className={styles['callList']}>
                {board.rows.map((r, i) => (
                  <li key={r.address}>
                    <Row r={r} place={i + 1} />
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      ) : null}
    </>
  );
}

function Row({ r, place }: { r: CallRow; place: number }) {
  const money = moneyLine(r);
  const tone = r.multiple === null ? styles['pillNone'] : r.multiple > 1 ? styles['pillUp'] : styles['pillFlat'];
  return (
    <a className={styles['callRow']} href={coinHref(r.address)}>
      {/* A call with no multiple is not ranked by anything, so it has no place, only the space. */}
      <Num className={styles['place']}>{r.multiple !== null ? place : ''}</Num>
      <CoinLogo small address={r.address} ticker={r.ticker} imageUrl={r.imageUrl} size={LOGO} />
      <div className={styles['callMid']}>
        <div className={styles['callTicker']}>{r.ticker === null ? '—' : `$${r.ticker}`}</div>
        <div className={styles['callSub']}>{notifiedLine(r)}</div>
        {money !== null ? <Num className={styles['callMoney']}>{money}</Num> : <div className={styles['callSub']}>{missingLine(r)}</div>}
      </div>
      <Num className={`${styles['pill']} ${tone}`}>{r.multiple === null ? '—' : multipleText(r.multiple)}</Num>
    </a>
  );
}

function Counting() {
  return (
    <>
      <div className={`${styles['hero']} ${styles['heroSkeleton']}`} aria-hidden="true">
        <span className={alerts['skeletonBar']} style={{ width: 120, height: 12 }} />
        <span className={alerts['skeletonBar']} style={{ width: 150, height: 36, marginTop: 14 }} />
        <span className={alerts['skeletonBar']} style={{ width: '100%', height: 40, marginTop: 20 }} />
      </div>
      <ul className={styles['callList']} aria-label="Loading">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className={styles['callRow']}>
            <span className={styles['place']} />
            <span className={alerts['skeletonFace']} />
            <div className={styles['callMid']}>
              <span className={alerts['skeletonBar']} style={{ width: 96 }} />
              <span className={alerts['skeletonBar']} style={{ width: 168, height: 12, marginTop: 8 }} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
