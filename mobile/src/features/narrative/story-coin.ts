/**
 * A NARRATIVE'S COIN LINE, the owner's three states (2026-10-17), on the Narratives card and the
 * narrative page's coin bar alike:
 *
 *   checked  the coin is proven from its posts, or the owner marked it right: logo, ticker, market
 *            cap and a purple Buy
 *   top      there is a top coin but nobody has checked it: logo, ticker, "Top coin, not checked"
 *            and Buy. ★ NEVER SHOWN AS THE NARRATIVE'S COIN: the words say what it is
 *   none     no coin with its name: "No coin yet" and Create
 *
 * and, outside those three, the narrative's own line with no button ("still checking"), never a
 * guess at a coin. Pure, so `node --test` holds which state a narrative is in.
 *
 * The narrative's own answer decides: `one` is checked (the projector settles a coin only when the
 * owner confirmed it or its posts prove it), the page's sheet may also mark a coin proven, and only
 * when neither has a coin does the payload's `topCoin` (the coin most posts list) come in.
 *
 * What breaks if changed carelessly: taking the sheet's first coin by market cap as the narrative's
 * coin would put Buy under the biggest coin with the name, which is exactly the unchecked guess the
 * owner ruled out.
 */

import type { Coin, SheetCoin, Story, StorySheet } from '../../shared/api/index.ts';
import { coinStatus } from '../../shared/coin-status.ts';
import type { Measured } from '../../shared/format/measure.ts';

/** One coin as the line draws it, from either the story's coin or the sheet's. */
export interface CoinFace {
  readonly address: string;
  readonly ticker: string | null;
  readonly name: string | null;
  readonly imageUrl: string | null;
  readonly marketCapUsd: Measured;
  /** The day's move in percent. */
  readonly changePct: Measured;
  /** The sheet's coin, when the page has one: its launch clock and the Buy ticket's address. */
  readonly sheet: SheetCoin | null;
}

export type StoryCoinState =
  | { readonly kind: 'checked'; readonly coin: CoinFace }
  | { readonly kind: 'top'; readonly coin: CoinFace }
  | { readonly kind: 'none' }
  | { readonly kind: 'line'; readonly line: string };

export function faceOfCoin(c: Coin, sheet: SheetCoin | null = null): CoinFace {
  return {
    address: c.address,
    ticker: c.ticker,
    name: c.name,
    imageUrl: c.imageUrl,
    marketCapUsd: sheet?.marketCapUsd.known === true ? sheet.marketCapUsd : c.marketCapUsd,
    changePct: sheet !== null ? sheet.changePct24h : c.priceChange24h.known ? { known: true, amount: c.priceChange24h.amount } : { known: false, pending: c.priceChange24h.pending },
    sheet,
  };
}

export function faceOfSheet(c: SheetCoin): CoinFace {
  return { address: c.address, ticker: c.ticker, name: c.name, imageUrl: c.imageUrl, marketCapUsd: c.marketCapUsd, changePct: c.changePct24h, sheet: c };
}

/** The state from the story alone (the Narratives card), or with its page's sheet (the coin bar). */
export function storyCoinState(story: Story, sheet: StorySheet | null = null): StoryCoinState {
  const bySheet = (address: string) => sheet?.coins.find((c) => c.address === address) ?? null;
  const proven = sheet?.coins.find((c) => c.proven) ?? null;
  if (proven !== null) return { kind: 'checked', coin: faceOfSheet(proven) };
  if (story.coins.kind === 'one') return { kind: 'checked', coin: faceOfCoin(story.coins.coin, bySheet(story.coins.coin.address)) };
  if (story.topCoin !== null) return { kind: 'top', coin: faceOfCoin(story.topCoin, bySheet(story.topCoin.address)) };
  if (story.coins.kind === 'several') return { kind: 'top', coin: faceOfCoin(story.coins.coins[0], bySheet(story.coins.coins[0].address)) };
  if (story.coins.kind === 'none') return { kind: 'none' };
  return { kind: 'line', line: coinStatus(story.coins).line };
}
