/**
 * THE FEED TAB'S CALLS — Insidor's own track record (the owner, 2026-11-13: "not for traders, it's to
 * see the calls Insidor has made and its x's"), chosen as design A of reports/feed-calls: Week / Month
 * / All time at the right, the record strip under it, then every call ranked by how far it ran.
 *
 * A row: the place, the coin's logo and ticker, "Found 41m before the coin" under it and "$5K → $21M"
 * under that; at the right the
 * multiple alone. Three short lines rather than two shared ones: side by side, the timing and the
 * money did not fit a 375px phone and were cut. The whole row opens the coin's token page and its
 * chart. The words are calls-words.ts.
 *
 * ★ FACTS ONLY. The server orders the rows and every number is a price on the coin's own chart; a
 * call it could not price shows a dash and "Price not recorded", and one whose peak had too little
 * money traded behind it "Little money traded" (a thin pool's price, not a run); never 0x or 1x, and
 * both still count as calls.
 * While the server is still counting (its first pass after a start), the list says so and asks again.
 *
 * The type is the app's one scale (tokens.css): the ticker at body size, the lines under it
 * secondary, and every figure — multiple, market caps, the strip's values — in the number face
 * (Num.tsx). Green is price direction only: a multiple over 1x is the coin up from where we found it.
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
import { foundLine, missingLine, moneyLine, multipleText, recordCells } from './calls-words.ts';
import { coinHref } from './lines.ts';
import styles from './following.module.css';

const WINDOWS: readonly { readonly key: CallsWindow; readonly label: string }[] = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All time' },
];

/** How soon to ask again while the server is still counting. */
const COUNTING_RETRY_MS = 4_000;
const LOGO = 40;

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

  return (
    <>
      <div className={styles['windowRow']}>
        <div className={styles['windows']} role="group" aria-label="Calls over">
          {WINDOWS.map((w) => (
            <button key={w.key} type="button" aria-pressed={w.key === span} className={w.key === span ? styles['windowOn'] : ''} onClick={() => setSpan(w.key)}>
              {w.label}
            </button>
          ))}
        </div>
      </div>
      {calls.state === 'loading' || counting ? <Counting /> : null}
      {calls.state === 'failed' ? <p className={alerts['centred']}>Insidor's calls couldn't be read just now. Pull down to try again.</p> : null}
      {calls.state === 'ready' && calls.value.state === 'ready' ? (
        <>
          <div className={styles['record']}>
            {recordCells(calls.value.record).map((c) => (
              <div key={c.label} className={styles['recordCell']}>
                <Num className={styles['recordValue']}>{c.value}</Num>
                <div className={styles['recordLabel']}>{c.label}</div>
              </div>
            ))}
          </div>
          {calls.value.rows.length === 0 ? (
            <div className={alerts['emptyBox']}>
              <p className={alerts['emptyText']}>{span === 'week' ? 'No calls this week yet.' : 'No calls yet.'}</p>
              {span === 'week' ? (
                <button type="button" className={alerts['emptyAction']} onClick={() => setSpan('all')}>
                  See all time
                </button>
              ) : null}
            </div>
          ) : (
            <ol className={alerts['list']}>
              {calls.value.rows.map((r, i) => (
                <li key={r.address}>
                  <Row r={r} place={i + 1} />
                </li>
              ))}
            </ol>
          )}
        </>
      ) : null}
    </>
  );
}

function Row({ r, place }: { r: CallRow; place: number }) {
  const money = moneyLine(r);
  const up = r.multiple !== null && r.multiple > 1;
  return (
    <a className={styles['callRow']} href={coinHref(r.address)}>
      {/* A call with no multiple is not ranked by anything, so it has no place, only the space. */}
      <span className={`${styles['place']} ${place <= 3 ? styles['placeTop'] : ''}`}>{r.multiple !== null ? place : ''}</span>
      <CoinLogo small address={r.address} ticker={r.ticker} imageUrl={r.imageUrl} size={LOGO} />
      <div className={styles['callMid']}>
        <div className={styles['callTicker']}>{r.ticker === null ? '—' : `$${r.ticker}`}</div>
        <div className={styles['callSub']}>{foundLine(r)}</div>
        {money !== null ? <Num className={styles['callMoney']}>{money}</Num> : <div className={styles['callSub']}>{missingLine(r)}</div>}
      </div>
      {/* Up is green (price direction, tokens.css rule 1); no multiple is a quiet grey dash, the absence and not a number. */}
      <Num className={`${styles['callMultiple']} ${up ? styles['callUp'] : r.multiple === null ? styles['callNone'] : ''}`}>{r.multiple === null ? '—' : multipleText(r.multiple)}</Num>
    </a>
  );
}

function Counting() {
  return (
    <ul className={alerts['list']} aria-label="Loading">
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className={alerts['skeletonRow']}>
          <span className={alerts['skeletonFace']} />
          <div>
            <span className={alerts['skeletonBar']} style={{ width: 96 }} />
            <span className={alerts['skeletonBar']} style={{ width: 168, height: 12, marginTop: 8 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
