/**
 * WHICH OWNER CONTROLS A CARD DRAWS, AND WHAT THEY SAY — pure, so every case runs under a test.
 *
 * ★ A COIN CALL IS ONLY OFFERED WHERE THERE IS A COIN TO CALL. A card naming one coin asks "Right
 * coin / Wrong coin" about THAT coin. A card that says we can't tell, with coins listed, asks
 * "Which coin?" and opens the list. Every other coin line (no coin yet, a dash, couldn't check, a
 * narrative's several coins) has no coin in front of the owner, so nothing is asked.
 *
 * ★ THE CARD SAYS WHAT THE OWNER SAID, IN THE OWNER'S WORDS. Never a mark of ours: "You said this
 * is the coin", not a tick or a number.
 *
 * What breaks if changed carelessly: `coinAsk` for `unsure` with no listed coins must be null —
 * "Which coin?" on an empty list is a question with no answers, and the list is what the owner
 * picks from.
 */

import type { Coin, PostCoinLink } from '../../shared/api/index.ts';
import type { SavedCall } from '../../shared/api/owner.ts';

/** Quick reasons for "Not a meme", one tap each; the owner can type any other. */
export const NOT_A_MEME_NOTES = ['ad', 'sports', 'news', 'politics', 'not funny', 'spam'] as const;

/** Quick reasons for a name, one tap each. */
export const NAME_NOTES = ['great character', 'too long', 'wrong subject', 'taken'] as const;

export type CoinAsk =
  | { readonly kind: 'confirm'; readonly coin: Coin }
  | { readonly kind: 'pick' };

export function coinAsk(coins: PostCoinLink): CoinAsk | null {
  if (coins.kind === 'one') return { kind: 'confirm', coin: coins.coin };
  if (coins.kind === 'unsure' && coins.claimCount > 0) return { kind: 'pick' };
  return null;
}

/** The line under a coin call once the owner has made one; null before. */
export function coinCallLine(saved: SavedCall | undefined): string | null {
  if (saved === undefined || saved.kind !== 'coin_match') return null;
  switch (saved.call) {
    case 'right':
      return 'You said this is the coin.';
    case 'wrong':
      return saved.coin === null ? 'You said this is the wrong coin.' : 'You said it is another coin, and picked it.';
    case 'none':
      return 'You said no coin is from this.';
    default:
      return null;
  }
}

/** The line beside a name chip once the owner has called it. */
export function nameCallLine(saved: SavedCall | undefined): string | null {
  if (saved === undefined || saved.kind !== 'name') return null;
  const better = saved.betterName === null ? '' : ` Better: ${saved.betterName}.`;
  return saved.call === 'up' ? `You liked this name.${better}` : `You passed on this name.${better}`;
}

/** "Hidden 3h ago", from when the call was saved. */
export function hiddenAgo(atMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - atMs) / 60_000));
  if (minutes < 1) return 'Hidden just now';
  if (minutes < 60) return `Hidden ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Hidden ${hours}h ago`;
  return `Hidden ${Math.round(hours / 24)}d ago`;
}
