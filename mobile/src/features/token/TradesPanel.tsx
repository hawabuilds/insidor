/**
 * THE TRADES TAB — Trador's `panels/TradesPanel.tsx`, rebuilt in our CSS modules and laid out as the
 * owner's slimmer token page (2026-10-17): ONE LINE A TRADE, 33px, in the order a fill is read: Buy
 * (green) or Sell (red), how long ago, how much of the coin moved, what it was worth in its side's
 * colour, and the short wallet that made it in grey monospace, opening the transaction. A hairline
 * between rows, no header row (each column says what it is by its own words and colours).
 *
 * The All, Buys, Sells and Mine filter is a small "All" menu at the right of the page's Trades,
 * Comments and Info row (`TapeFilterMenu`, drawn by TokenView), so the filter costs no row of its own
 * and two whole trades show above Buy and Sell on a 390 by 844 phone.
 *
 * Live: the page reads the coin's market again every few seconds (TokenView), and a trade that
 * was not there before slides in, as Trador's tape does. The first read animates nothing.
 *
 * ★ AN OUTAGE IS NOT AN EMPTY TAPE. Trades the source could not read say so; "No trades yet" is
 * only for a source that answered with none. A trade's missing number is a dash with its reason.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { CoinTheses, MarketTrade } from '../../shared/api/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { formatCount } from '../../shared/format/number.ts';
import { ChevronIcon } from '../../shared/ui/icons.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { arrivals, emptyLine, filterTape, filtersFor, shortWallet, tradeKeys, tradeUsd, type TapeFilter } from './trades-view.ts';
import { FomoTheses } from './FomoTheses.tsx';
import styles from './token.module.css';

/** How long a new row stays marked: longer than its slide-in, shorter than the next read. */
const ARRIVAL_HOLD_MS = 1_200;
/** Rows shown; the full history is a tap away on the explorer. */
const TRADES_SHOWN = 50;

/** The filter in force: Mine without a signed-in wallet has nothing to match, so it is All, never an empty tape. */
export const tapeFilterFor = (picked: TapeFilter, account: string | null): TapeFilter => (picked === 'mine' && account === null ? 'all' : picked);

export function TradesPanel({ ticker, trades, note, account, now, filter, coinAddress, theses }: {
  ticker: string;
  /** Null while there is nothing to list: `note` says why (loading, unread, none yet). */
  trades: readonly MarketTrade[] | null;
  note: string;
  account: string | null;
  now: number;
  /** The menu's choice, already through `tapeFilterFor`. */
  filter: TapeFilter;
  coinAddress?: string;
  theses?: CoinTheses | null;
}) {
  const shown = useMemo(() => (trades === null ? [] : filterTape(trades, filter, account).slice(0, TRADES_SHOWN)), [trades, filter, account]);
  const keys = useMemo(() => tradeKeys(shown), [shown]);
  const fresh = useArrivals(keys, filter);

  return (
    <div>
      {trades === null ? (
        <p className={styles['panelNote']}>{note}</p>
      ) : shown.length === 0 ? (
        <p className={styles['panelNote']}>{trades.length === 0 ? note : emptyLine(filter, ticker)}</p>
      ) : (
        <ul className={styles['tape']}>
          {shown.map((t, i) => {
            const key = keys[i] ?? String(i);
            const buy = t.side === 'buy';
            const wallet = t.maker === null ? null : shortWallet(t.maker);
            return (
              <li key={key} className={`${styles['tradeLine']} ${fresh.has(key) ? styles['tradeIn'] : ''}`}>
                <span className={`${styles['lineSide']} ${buy ? styles['up'] : styles['down']}`}>{buy ? 'Buy' : 'Sell'}</span>
                <span className={styles['lineAge']}><Value r={formatAge(t.at, now as never)} /></span>
                <span className={styles['lineAmount']}>
                  <Value r={formatCount(t.tokenAmount)} /> {ticker}
                </span>
                <span className={`${styles['lineUsd']} ${buy ? styles['up'] : styles['down']}`}><Value r={tradeUsd(t.usd)} /></span>
                {t.tx !== null ? (
                  <a className={styles['lineWallet']} href={`https://solscan.io/tx/${t.tx}`} target="_blank" rel="noopener noreferrer" aria-label="View transaction">
                    {wallet ?? 'Txn'}
                  </a>
                ) : (
                  <span className={styles['lineWallet']}>{wallet ?? ''}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {theses !== undefined && theses !== null && coinAddress !== undefined ? (
        <FomoTheses theses={theses} coinAddress={coinAddress} now={now} />
      ) : null}
    </div>
  );
}

/**
 * The small "All" menu at the right of the Trades, Comments and Info row: the filter's name and a
 * down arrow; a tap opens All, Buys, Sells (and Mine with a wallet signed in) under it, and a choice
 * or a tap anywhere else closes it.
 */
export function TapeFilterMenu({ filter, account, onPick }: { filter: TapeFilter; account: string | null; onPick: (f: TapeFilter) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const options = filtersFor(account);
  const label = options.find((o) => o.value === filter)?.label ?? 'All';
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current !== null && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  return (
    <div ref={box} className={styles['tapeMenu']}>
      <button type="button" className={styles['tapeMenuButton']} aria-haspopup="menu" aria-expanded={open} aria-label={`Showing ${label} trades`} onClick={() => setOpen((o) => !o)}>
        {label}
        <span className={styles['tapeMenuArrow']}><ChevronIcon size={13} /></span>
      </button>
      {open ? (
        <div className={styles['tapeMenuList']} role="menu">
          {options.map((o) => (
            <button key={o.value} type="button" role="menuitemradio" aria-checked={o.value === filter} className={o.value === filter ? styles['tapeMenuOn'] : ''} onClick={() => {
              onPick(o.value);
              setOpen(false);
            }}>
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
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
