/**
 * QUICK BUY ON CHOOSE COIN — the amount and slippage a ⚡ button buys with, saved for each signed-in
 * wallet, and the one path a ⚡ tap takes to a sent transaction.
 *
 * Its own file, apart from the order ticket (features/trade, which is not changed): the ticket asks
 * for an amount every time, and this remembers one. They share every step that touches money —
 * the same quote, the same build-and-simulate, the same wallet signature (`confirmOrder` in
 * order-flow.ts) — so there is one way a buy is made, and a quick buy is only a ticket whose amount
 * was chosen in advance.
 *
 * ★ NEVER ABOVE THE CAP. The trade service caps a buy's amount PLUS its slippage
 * (`policy.trade.maxSolPerTrade`, services/trade gate.ts). An amount over the largest buy the cap
 * allows at the chosen slippage is not offered (`quickAmounts`), and a saved amount the cap no
 * longer allows falls to the largest one it does. With the cap at 0.05 SOL, 0.05 itself is never
 * offered: 0.05 plus any slippage is over it.
 *
 * ★ CHECKED BEFORE SIGNING. A refused quote, a price impact past the ticket's block, or a failed
 * simulation stops before the wallet is asked, and says why. Nothing here holds or logs a key.
 */

import type { SendOutcome } from '@insidor/contracts/ports/wallet.ts';

import { buildTrade, fetchTradeQuote, type TradeLimits } from '../../shared/api/index.ts';
import { confirmOrder, fromBase64, IMPACT_BLOCK_PCT, largestBuy, SLIPPAGE_CHOICES, toBaseUnits, type ConfirmOutcome } from '../trade/order-flow.ts';

/** The design's three amounts, in SOL. */
export const QUICK_AMOUNTS_SOL = ['0.01', '0.025', '0.05'] as const;
/** The ticket's own slippage choices, in basis points. */
export const QUICK_SLIPPAGES = SLIPPAGE_CHOICES;

export interface QuickChoice {
  readonly amountSol: string;
  readonly slippageBps: number;
}

export const QUICK_DEFAULT: QuickChoice = { amountSol: '0.05', slippageBps: 300 };

/** The amounts a ⚡ may buy at this slippage: under the cap with their slippage. None when the cap is unknown. */
export function quickAmounts(limits: TradeLimits | null, slippageBps: number): readonly string[] {
  if (limits === null) return [];
  const top = largestBuy(limits, slippageBps);
  return QUICK_AMOUNTS_SOL.filter((a) => (toBaseUnits(a, 9) ?? 0n) <= top);
}

/** The slippages the server accepts. */
export function quickSlippages(limits: TradeLimits | null): readonly number[] {
  return QUICK_SLIPPAGES.filter((b) => limits === null || b <= limits.maxSlippageBps);
}

/**
 * The choice to use: the saved one when the cap still allows it, else the largest amount it allows
 * at that slippage. Null when no amount fits (the ⚡ buttons are then not drawn).
 */
export function effectiveChoice(saved: QuickChoice, limits: TradeLimits | null): QuickChoice | null {
  const slippages = quickSlippages(limits);
  const slippageBps = slippages.includes(saved.slippageBps) ? saved.slippageBps : (slippages.filter((b) => b <= saved.slippageBps).pop() ?? slippages[0] ?? saved.slippageBps);
  const amounts = quickAmounts(limits, slippageBps);
  if (amounts.length === 0) return null;
  const amountSol = amounts.includes(saved.amountSol as (typeof QUICK_AMOUNTS_SOL)[number]) ? saved.amountSol : (amounts[amounts.length - 1] ?? saved.amountSol);
  return { amountSol, slippageBps };
}

/* ── saved per wallet, on this device ───────────────────────────────── */

const KEY = 'insidor.mobile.quickBuy.v1';

const keyFor = (account: string | null) => `${KEY}:${account ?? 'signed-out'}`;

export function readQuickChoice(account: string | null): QuickChoice {
  try {
    const raw = JSON.parse(window.localStorage.getItem(keyFor(account)) ?? 'null') as Partial<QuickChoice> | null;
    if (raw !== null && typeof raw.amountSol === 'string' && (QUICK_AMOUNTS_SOL as readonly string[]).includes(raw.amountSol) && typeof raw.slippageBps === 'number' && (QUICK_SLIPPAGES as readonly number[]).includes(raw.slippageBps)) {
      return { amountSol: raw.amountSol, slippageBps: raw.slippageBps };
    }
  } catch {
    /* Blocked storage: the default. */
  }
  return QUICK_DEFAULT;
}

export function saveQuickChoice(account: string | null, choice: QuickChoice): void {
  try {
    window.localStorage.setItem(keyFor(account), JSON.stringify(choice));
  } catch {
    /* Private mode or blocked storage: the choice lasts this screen. */
  }
}

/* ── one ⚡ tap ──────────────────────────────────────────────────────── */

export type QuickOutcome = ConfirmOutcome | { readonly kind: 'no-price'; readonly why: string };

/**
 * Quote, build and simulate, sign, send: the ticket's path with the amount chosen in advance. The
 * wallet is asked to sign only after the trade service's simulation passed (`confirmOrder`).
 */
export async function quickBuy(
  order: { readonly mint: string; readonly account: string; readonly choice: QuickChoice },
  deps: {
    readonly signAndSend: (payload: Uint8Array) => Promise<SendOutcome>;
    readonly onSigning?: () => void;
    readonly quote?: typeof fetchTradeQuote;
    readonly build?: typeof buildTrade;
  },
): Promise<QuickOutcome> {
  const lamports = toBaseUnits(order.choice.amountSol, 9);
  if (lamports === null) return { kind: 'no-price', why: 'That is not an amount.' };
  const q = await (deps.quote ?? fetchTradeQuote)({ mint: order.mint, side: 'buy', amount: lamports.toString(), wallet: order.account, slippageBps: order.choice.slippageBps });
  if (q.kind === 'refused') return { kind: 'no-price', why: q.why };
  const impact = q.quote.priceImpactPct === null ? null : Math.abs(q.quote.priceImpactPct * 100);
  if (impact !== null && impact >= IMPACT_BLOCK_PCT) return { kind: 'no-price', why: `Price impact is ${impact.toFixed(1)}%, too high to place.` };
  const build = deps.build ?? buildTrade;
  return confirmOrder(q.quote, {
    build: async (x) => {
      const built = await build(x, order.account);
      if (built.kind === 'ready') deps.onSigning?.();
      return built;
    },
    signAndSend: deps.signAndSend,
    decode: fromBase64,
  });
}

/** The toast's words for an outcome. A sent buy also gets a link to its transaction. */
export function outcomeLine(o: QuickOutcome, amountSol: string, ticker: string): string {
  switch (o.kind) {
    case 'sent':
      return `Bought ${amountSol} SOL of $${ticker}`;
    case 'blocked':
      return `Not sent: ${o.why}`;
    case 'no-price':
      return `Not sent: ${o.why}`;
    case 'refused':
      return 'You declined it in your wallet. Nothing was sent.';
    case 'not-sent':
      return `The network did not take it: ${o.why}`;
    case 'unavailable':
      return 'Your wallet is not available just now. Nothing was sent.';
    case 'failed':
      return 'Something went wrong. Check your wallet before trying again.';
  }
}
