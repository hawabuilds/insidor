/**
 * Whether a sell just sent has LANDED — what the Buy/Sell ticket waits on before it opens the
 * share sheet by itself (OrderSheet.tsx). The owner, 2026-10-24: "I sold, I didn't get the flex
 * card" — the card sat behind a link under Done that nobody saw.
 *
 * Its own file so the rule can be tested without a page: the ticket asks the same read the share
 * sheet draws from (GET /sell/:signature/card, services/read trade-card.ts), every few seconds,
 * for as long as the trade service looks for a landing.
 *
 * ★ ONLY A LANDED SELL OPENS THE CARD. `read` means the sell was seen landed and succeeded. A sell
 * that failed, was not found, or was never seen landing in time answers `false`, and nothing opens:
 * a card for a sell that did not happen is the one thing this must not show. A read that errors is
 * asked again within the same time, because a dropped request is not a failed sell.
 *
 * What breaks if changed carelessly: answering `true` on `pending`. The card would open on a sell
 * still in flight, and if that sell failed the person would have been offered a flex for it.
 */

import type { SellCard } from '../../shared/api/index.ts';

/** How often a sell not yet landed is asked about, and for how long: the trade service stops looking after about two and a half minutes. */
export const ASK_EVERY_MS = 3_000;
export const ASK_FOR_MS = 160_000;

export interface LandedDeps {
  readonly ask: (signature: string, signal: AbortSignal) => Promise<SellCard>;
  readonly wait: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly signal: AbortSignal;
}

/** True once the sell is seen landed; false when it failed, is not known, was not seen in time, or the wait was abandoned. */
export async function sellLanded(signature: string, deps: LandedDeps): Promise<boolean> {
  const started = deps.now();
  for (;;) {
    if (deps.signal.aborted) return false;
    let card: SellCard | null = null;
    try {
      card = await deps.ask(signature, deps.signal);
    } catch {
      card = null;
    }
    if (deps.signal.aborted) return false;
    if (card?.kind === 'read') return true;
    if (card?.kind === 'none') return false;
    if (deps.now() - started >= ASK_FOR_MS) return false;
    await deps.wait(ASK_EVERY_MS);
  }
}
