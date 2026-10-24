/**
 * THE FLEX CARD FOR A SELL WHOSE TICKET WAS CLOSED BEFORE IT LANDED (the owner, 2026-10-24: "I just
 * sold a coin without a flex card"). The ticket (OrderSheet.tsx) opens the share sheet itself once a
 * sell lands — but it waited only while it was open, and a sell lands a few seconds after it is
 * signed: tapping Done or closing the ticket in those seconds ended the wait, and no card came.
 *
 * So a ticket closed with a sell still landing hands the wait to here (`handOffSell`), which keeps
 * asking (sell-landed.ts, the same rule: only a landed sell ever opens the card) and, once it lands,
 * shows the share sheet over whatever screen is up (`LateFlex`, mounted once in App.tsx). One at a
 * time: a newer hand-off replaces an older one still waiting.
 *
 * What breaks if changed carelessly: opening on anything but a landed sell, as sell-landed.ts says.
 */

import { useSyncExternalStore } from 'react';

import { fetchSellCard } from '../../shared/api/index.ts';
import { sellLanded } from './sell-landed.ts';
import { ShareTradeSheet } from './ShareTradeSheet.tsx';

export interface LateSell {
  readonly signature: string;
  readonly mint: string;
  readonly ticker: string;
  readonly subline: string | null;
  readonly signedIn: boolean;
}

let shown: LateSell | null = null;
let waiting: AbortController | null = null;
const listeners = new Set<() => void>();
const tell = (): void => listeners.forEach((l) => l());

/** Keep waiting for this sell to land after its ticket closed; show its card when it does. */
export function handOffSell(sell: LateSell): void {
  waiting?.abort();
  const ac = new AbortController();
  waiting = ac;
  void sellLanded(sell.signature, {
    ask: fetchSellCard,
    wait: (ms) => new Promise((done) => setTimeout(done, ms)),
    now: Date.now,
    signal: ac.signal,
  }).then((landed) => {
    if (waiting === ac) waiting = null;
    if (!landed || ac.signal.aborted) return;
    shown = sell;
    tell();
  });
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The handed-off sell's share sheet, over any screen, once it has landed. */
export function LateFlex() {
  const sell = useSyncExternalStore(subscribe, () => shown);
  if (sell === null) return null;
  return (
    <ShareTradeSheet
      signature={sell.signature}
      mint={sell.mint}
      ticker={sell.ticker}
      subline={sell.subline}
      signedIn={sell.signedIn}
      onClose={() => {
        shown = null;
        tell();
      }}
    />
  );
}
