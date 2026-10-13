/**
 * THE TRADES TAB — Trador's `panels/TradesPanel.tsx` and the filter rail above it, rebuilt in our
 * CSS modules: four columns in the order a fill is read (what happened and when, how much of the
 * coin moved and at what price, what it was worth, where to verify it), one fixed grid shared by
 * the header and every row so the labels sit on their numbers, no rules between rows.
 *
 * Live: the page reads the coin's market again every few seconds (TokenView), and a trade that
 * was not there before slides in, as Trador's tape does. The first read animates nothing.
 *
 * ★ AN OUTAGE IS NOT AN EMPTY TAPE. Trades the source could not read say so; "No trades yet" is
 * only for a source that answered with none. A trade's missing number is a dash with its reason.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { MarketTrade } from '../../shared/api/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { formatCount, formatPrice, formatUsd } from '../../shared/format/number.ts';
import { ExternalIcon } from '../../shared/ui/icons.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { arrivals, emptyLine, filterTape, filtersFor, tradeKey, type TapeFilter } from './trades-view.ts';
import styles from './token.module.css';

/** How long a new row stays marked: longer than its slide-in, shorter than the next read. */
const ARRIVAL_HOLD_MS = 1_200;
/** Rows shown; the full history is a tap away on the explorer. */
const TRADES_SHOWN = 50;

export function TradesPanel({ ticker, trades, note, account, now }: {
  ticker: string;
  /** Null while there is nothing to list: `note` says why (loading, unread, none yet). */
  trades: readonly MarketTrade[] | null;
  note: string;
  account: string | null;
  now: number;
}) {
  const [picked, setFilter] = useState<TapeFilter>('all');
  /* Mine without a signed-in wallet has nothing to match; it falls back to All, never an empty tape. */
  const filter: TapeFilter = picked === 'mine' && account === null ? 'all' : picked;
  const options = filtersFor(account);
  const shown = useMemo(() => (trades === null ? [] : filterTape(trades, filter, account).slice(0, TRADES_SHOWN)), [trades, filter, account]);
  const fresh = useArrivals(shown.map(tradeKey), filter);

  return (
    <div>
      <div className={styles['rail']} role="group" aria-label="Whose trades">
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={o.value === filter} className={o.value === filter ? styles['railOn'] : ''} onClick={() => setFilter(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {trades === null ? (
        <p className={styles['panelNote']}>{note}</p>
      ) : shown.length === 0 ? (
        <p className={styles['panelNote']}>{trades.length === 0 ? note : emptyLine(filter, ticker)}</p>
      ) : (
        <div className={styles['tape']}>
          <div className={`${styles['tapeRow']} ${styles['tapeHead']}`}>
            <span>Type</span>
            <span>Amount</span>
            <span className={styles['right']}>USD</span>
            <span className={styles['right']}>TXN</span>
          </div>
          <ul>
            {shown.map((t) => {
              const key = tradeKey(t);
              const buy = t.side === 'buy';
              return (
                <li key={key} className={`${styles['tapeRow']} ${fresh.has(key) ? styles['tradeIn'] : ''}`}>
                  <div>
                    <span className={`${styles['side']} ${buy ? styles['up'] : styles['down']}`}>{buy ? 'Buy' : 'Sell'}</span>
                    <span className={styles['sub']}><Value r={formatAge(t.at, now as never)} /></span>
                  </div>
                  <div className={styles['amount']}>
                    <span className={styles['amountN']}>
                      <Value r={formatCount(t.tokenAmount)} />
                      <span className={styles['unit']}>{ticker}</span>
                    </span>
                    <span className={styles['sub']}><Value r={formatPrice(t.priceUsd)} /></span>
                  </div>
                  <span className={`${styles['usd']} ${buy ? styles['up'] : styles['down']}`}><Value r={formatUsd(t.usd)} /></span>
                  {t.tx === null ? (
                    <span className={`${styles['txn']} ${styles['right']}`}>—</span>
                  ) : (
                    <a className={styles['txn']} href={`https://solscan.io/tx/${t.tx}`} target="_blank" rel="noopener noreferrer" aria-label="View transaction">
                      {t.tx.slice(0, 4)}…{t.tx.slice(-4)}
                      <ExternalIcon size={11} />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Trador's useArrivals: the keys new since the last read, cleared once their slide-in has played. */
function useArrivals(keys: readonly string[], resetKey: string): ReadonlySet<string> {
  const seen = useRef<ReadonlySet<string> | null>(null);
  const lastReset = useRef(resetKey);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const joined = keys.join(',');
  useEffect(() => {
    if (keys.length === 0) return;
    if (lastReset.current !== resetKey) {
      lastReset.current = resetKey;
      seen.current = null;
    }
    const next = arrivals(seen.current, keys);
    seen.current = next.seen;
    if (next.fresh.size === 0) return;
    setFresh(next.fresh);
    const timer = setTimeout(() => setFresh(new Set()), ARRIVAL_HOLD_MS);
    return () => clearTimeout(timer);
    // `joined` stands for the keys' contents; the array itself is new each render.
  }, [joined, resetKey]);
  return fresh;
}
