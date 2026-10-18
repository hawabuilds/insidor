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
import { fresh, kept } from '../../shared/kept-reads.ts';
import { pending } from '../../shared/format/measure.ts';
import { tradingOn } from '../../shared/trading.ts';
import { useComingSoon } from '../../shared/ui/ComingSoon.tsx';
import { useDismiss } from '../../shared/ui/dismiss.ts';
import { availability } from '../trade/order-flow.ts';
import { OrderSheet } from '../trade/OrderSheet.tsx';
import styles from './post-sheet.module.css';
import { tickerText } from '../../shared/format/ticker.ts';

/* Read once, at build time, as TradeBar.tsx reads it. */
export const TRADING = tradingOn({ VITE_TRADING: import.meta.env?.['VITE_TRADING'] as string | undefined });
/** A venue read this recently is used as it is; older, it is read again. */
const VENUE_FRESH_MS = 60_000;

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

type Venue = Awaited<ReturnType<typeof fetchTradeVenue>>;

/**
 * The coin a Buy was tapped on: the ticket opens AT ONCE (the owner, 2026-10-18: the pop-up opens
 * straight away), and the venue's limits fill in when they are read — the same ticket, the same
 * steps, only sooner. A venue already read in the last minute (a coin page, a read ahead) is used
 * as it is; one that says the coin cannot be traded here closes the ticket with the reason in the
 * toast, as before.
 */
export function BuyOpen({ mint, ticker, onClose, onNote }: { mint: string; ticker: string; onClose: () => void; onNote: (n: SheetNote) => void }) {
  const soon = useComingSoon();
  useDismiss(onClose);
  const known = kept<Venue>(`venue:${mint}`);
  const knownOpen = known !== undefined && Date.now() - known.at < VENUE_FRESH_MS && availability(true, known.value.venue).kind === 'open';
  const [limits, setLimits] = useState<TradeLimits | null>(knownOpen ? known.value.limits : null);
  useEffect(() => {
    if (!TRADING) {
      soon(`Buying ${tickerText(ticker)}`);
      onClose();
      return;
    }
    if (knownOpen) return;
    const ac = new AbortController();
    fresh(`venue:${mint}`, (signal) => fetchTradeVenue(mint, signal), false, ac.signal).then(
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
  if (!TRADING) return null;
  return <OrderSheet mint={mint} ticker={ticker} side="buy" limits={limits} priceUsd={pending('not_read_yet')} onClose={onClose} />;
}
