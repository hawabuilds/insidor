/**
 * THE FEED TAB'S CALLS — Insidor's own track record (the owner, 2026-11-13: "not for traders, it's to
 * see the calls Insidor has made and its x's"), every multiple measured from the market cap we told
 * people (2026-11-14). Version 20 of reports/feed-calls, the owner's pick after many rounds:
 *
 *   Week / Month / All time   a full-width segmented control
 *   the strip                 Calls · 2x or more · 10x or more · Best (green)
 *   the rows                  flat, no card: the place, the coin's logo, its ticker with
 *                             "2h before launch" under it (when we saw the post); at the right the
 *                             multiple, bold and green, with "$19K → $590K" under it in quiet grey
 *                             (the owner: "turn that down a little so the focus can be on the green")
 *
 * ★ THE TOKEN PAGE'S NUMBER FACE. Every figure here is Inter, heavy and tight, as the token page sets
 * its price and market cap (the owner, 2026-11-14: "use same font for numbers and keep consistent") —
 * not the mono face the rest of the lists use.
 *
 * ★ FACTS ONLY. The server orders the rows and counts the record; every number is the cap we told
 * people or a price the coin traded at. A call it could not price shows a quiet dash and its reason
 * ("Price not recorded", or "Little money traded" for a thin pool's price), never 0x or 1x, has no
 * place, and still counts. While the server is still counting (its first pass after a start) the
 * screen shows skeleton rows and asks again.
 *
 * What breaks if changed carelessly: re-sorting or re-counting here. The ranking and the record are
 * the server's, so every phone shows the same record. The whole row opens the coin's token page.
 */

import { useEffect, useState } from 'react';

import { fetchCalls, type CallRow, type CallsWindow } from '../../shared/api/index.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import alerts from '../alerts/alerts.module.css';
import { launchLine, missingLine, moneyLine, multipleText, recordCells } from './calls-words.ts';
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

export function CallsList() {
  const now = useNow();
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
          <div className={styles['strip']}>
            {recordCells(board.record).map((c) => (
              <div key={c.label} className={styles['stripCell']}>
                <span className={`${styles['fig']} ${styles['stripValue']} ${c.up ? styles['up'] : ''}`}>{c.value}</span>
                <span className={styles['stripLabel']}>{c.label}</span>
              </div>
            ))}
          </div>
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
            <ol className={styles['callList']}>
              {board.rows.map((r, i) => (
                <li key={r.address}>
                  <Row r={r} place={i + 1} now={now} />
                </li>
              ))}
            </ol>
          )}
        </>
      ) : null}
    </>
  );
}

function Row({ r, place, now }: { r: CallRow; place: number; now: number }) {
  const money = moneyLine(r);
  const tone = r.multiple === null ? styles['none'] : r.multiple > 1 ? styles['up'] : styles['flat'];
  return (
    <a className={styles['callRow']} href={coinHref(r.address)}>
      {/* A call with no multiple is not ranked by anything, so it has no place, only the space. */}
      <span className={`${styles['fig']} ${styles['place']} ${place <= 3 ? styles['placeTop'] : ''}`}>{r.multiple !== null ? place : ''}</span>
      <CoinLogo small address={r.address} ticker={r.ticker} imageUrl={r.imageUrl} size={LOGO} />
      <div className={styles['callMid']}>
        <div className={styles['callTicker']}>{r.ticker === null ? '—' : `$${r.ticker}`}</div>
        <div className={styles['callSub']}>{launchLine(r, now)}</div>
      </div>
      <div className={styles['callRight']}>
        <span className={`${styles['fig']} ${styles['callMultiple']} ${tone}`}>{r.multiple === null ? '—' : multipleText(r.multiple)}</span>
        {money !== null ? <span className={`${styles['fig']} ${styles['callMoney']}`}>{money}</span> : <span className={styles['callMissing']}>{missingLine(r)}</span>}
      </div>
    </a>
  );
}

function Counting() {
  return (
    <ul className={styles['callList']} aria-label="Loading">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className={styles['callRow']}>
          <span className={styles['place']} />
          <span className={alerts['skeletonFace']} />
          <div className={styles['callMid']}>
            <span className={alerts['skeletonBar']} style={{ width: 96 }} />
            <span className={alerts['skeletonBar']} style={{ width: 132, height: 12, marginTop: 8 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
