/**
 * OPENING THE EXISTING BUY TICKET FROM THE POST SHEET, and the sheet's own short toast.
 *
 * The post sheet's purple Buy opens features/trade/OrderSheet.tsx exactly as a coin page's Buy does
 * (TradeBar.tsx): trading off, it says "Coming soon"; on, the coin's venue and the gate's limits are
 * read first, and the ticket opens only where a trade can work — otherwise the toast says why. The
 * ticket itself is not changed or wrapped; only called. The phone's back closes the ticket and
 * leaves the post sheet open under it (one history entry for the ticket, shared/ui/dismiss.ts),
 * because the ticket cannot do that itself and the owner keeps it as it is.
 *
 * The toast is the sheet's, not the app's Coming-soon toast, because it carries a link (a sent
 * buy's transaction) and sits above the sheet's scrim.
 */

import { useEffect, useState } from 'react';

import { fetchTradeVenue, type TradeLimits } from '../../shared/api/index.ts';
import { pending } from '../../shared/format/measure.ts';
import { tradingOn } from '../../shared/trading.ts';
import { useComingSoon } from '../../shared/ui/ComingSoon.tsx';
import { useDismiss } from '../../shared/ui/dismiss.ts';
import { availability } from '../trade/order-flow.ts';
import { OrderSheet } from '../trade/OrderSheet.tsx';
import styles from './post-sheet.module.css';

/* Read once, at build time, as TradeBar.tsx reads it. */
export const TRADING = tradingOn({ VITE_TRADING: import.meta.env?.['VITE_TRADING'] as string | undefined });

export interface SheetNote {
  readonly line: string;
  /** A sent transaction's signature: the toast links to it. */
  readonly tx?: string;
}

export function SheetToast({ note, onDone }: { note: SheetNote | null; onDone: () => void }) {
  useEffect(() => {
    if (note === null) return;
    const t = setTimeout(onDone, note.tx === undefined ? 4_000 : 9_000);
    return () => clearTimeout(t);
  }, [note, onDone]);
  if (note === null) return null;
  return (
    <div className={styles['toast']} role="status" aria-live="polite">
      <span>{note.line}</span>
      {note.tx !== undefined ? (
        <a href={`https://solscan.io/tx/${note.tx}`} target="_blank" rel="noopener noreferrer">View transaction</a>
      ) : null}
    </div>
  );
}

/** The coin a Buy was tapped on, while its venue is read; then the ticket, or the reason in the toast. */
export function BuyOpen({ mint, ticker, onClose, onNote }: { mint: string; ticker: string; onClose: () => void; onNote: (n: SheetNote) => void }) {
  const soon = useComingSoon();
  useDismiss(onClose);
  const [limits, setLimits] = useState<TradeLimits | null | 'reading'>('reading');
  useEffect(() => {
    if (!TRADING) {
      soon(`Buying $${ticker}`);
      onClose();
      return;
    }
    const ac = new AbortController();
    fetchTradeVenue(mint, ac.signal).then(
      (v) => {
        const a = availability(true, v.venue);
        if (a.kind === 'open') setLimits(v.limits);
        else {
          onNote({ line: a.kind === 'closed' ? a.line : "Trading isn't available just now" });
          onClose();
        }
      },
      () => {
        if (ac.signal.aborted) return;
        onNote({ line: "Trading isn't available just now" });
        onClose();
      },
    );
    return () => ac.abort();
    // One read per tap: the props are fixed for this opener's life.
  }, []);
  if (limits === 'reading') return null;
  return <OrderSheet mint={mint} ticker={ticker} side="buy" limits={limits} priceUsd={pending('not_read_yet')} onClose={onClose} />;
}
