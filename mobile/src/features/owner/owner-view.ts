/**
 * WHICH OWNER CONTROLS A CARD DRAWS, AND WHAT THEY SAY — pure, so every case runs under a test.
 *
 * ★ A COIN CALL IS OFFERED ON EVERY POST'S OWN COIN LINE. A card naming one coin (a narrative's
 * one, or the post's own proven coin) asks "Right coin / Wrong coin" about THAT coin. Every other
 * post line — we can't tell, no coin yet, a dash, couldn't check — asks "Which coin?", whose sheet
 * lists the coins with the post's name (if any) and always takes a pasted contract address, so it
 * always has an answer to give. A narrative's several coins are the narrative's, and ask nothing.
 *
 * ★ THE CARD SAYS WHAT THE OWNER SAID, IN THE OWNER'S WORDS. Never a mark of ours: "You said this
 * is the coin", not a tick or a number.
 *
 * What breaks if changed carelessly: `launchLine`. A coin launched before the post cannot have come
 * from it; the owner may still save it, but the preview must say so in those words, never hide it.
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
  if (coins.kind === 'one' || coins.kind === 'matched') return { kind: 'confirm', coin: coins.coin };
  if (coins.kind === 'several') return null;
  return { kind: 'pick' };
}

const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_SHOWN_AS_HOURS = 2;

/** "18m", "3h", "2d": a gap the way the card says one. */
function gap(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / MINUTE_MS);
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m`;
  const hours = Math.round(minutes / MINUTES_PER_HOUR);
  return hours < HOURS_PER_DAY * DAYS_SHOWN_AS_HOURS ? `${hours}h` : `${Math.round(hours / HOURS_PER_DAY)}d`;
}

/** A pasted coin's launch against the post, and whether it is older than the post. */
export function launchLine(launchedAfterMs: number | null): { readonly line: string; readonly older: boolean } {
  if (launchedAfterMs === null) return { line: 'When it launched against the post is not known', older: false };
  if (launchedAfterMs >= 0) return { line: `Launched ${gap(launchedAfterMs)} after the post`, older: false };
  return { line: `Launched ${gap(launchedAfterMs)} before the post`, older: true };
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
