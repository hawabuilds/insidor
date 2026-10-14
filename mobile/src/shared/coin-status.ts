/**
 * THE ONE LINE AND THE ONE BUTTON A STORY GETS, from its coin link and nothing else.
 *
 * Shared by the feed, the Narratives list and the narrative page, so the rule is stated once.
 * It is the desktop app's `row-action.ts` rule (app/src/features/feed/row-action.ts) in the
 * phone app's words:
 *
 *   none     → "No coin yet"            + Create coin
 *   pending  → "—" (not searched yet)    and NO BUTTON
 *   unchecked → "Couldn't check" (a post's search failed for minutes) and NO BUTTON: never
 *               Create, since a coin may exist under the name, and never a guess
 *   one      → "1 coin"                 + Buy $TICKER, if the server says it can be traded
 *   several  → "13 coins on pump.fun"   + View coins
 *   unsure   → a line saying we cannot tell which coin is from this, and NO BUTTON
 *
 * ★ `unsure` HAS NO BUTTON, NOT A DISABLED ONE. A disabled button says "this exists but you
 * may not have it" and invites waiting. The honest render of "we do not know which coin this
 * is" is an absent affordance and a sentence. The type makes the mistake unwritable: `unsure`
 * carries no coin on the wire, so there is nothing a Buy button could be built from.
 *
 * ★ A FEED POST'S CARD IS THE ONE PLACE `unsure` HAS BUTTONS (`postCoinStatus`), and neither is
 * Buy: "See 3 coins" opens the list of coins that use the name, each opening its own page, and
 * Create, since the person may make the coin they meant. The owner's four card states:
 *
 *   one       → "$TICKER, $42K market cap" + Buy $TICKER
 *   matched   → the same line and Buy, for the post's OWN coin settled by evidence, with why
 *               as facts beneath it: "Links this post", "Same picture", "Launched 12m after";
 *               or the coin the owner confirmed for the post's story: "Coin for this story"
 *   unsure    → "3 coins use this name. We can't tell which one came from here." + See 3 coins
 *               + Create coin (never Buy on the card)
 *   none      → "No coin yet" + Create coin
 *   pending   → a dash; unchecked → "Couldn't check"; both with no button
 *
 * The narrative screens keep `coinStatus`: a narrative's unsure line has no button there.
 *
 * ★ A COIN THE SERVER CANNOT QUOTE GETS NO BUTTON EITHER. `tradable` is the server's call,
 * made by asking for a quote, and this only obeys it.
 */

import type { Coin, CoinEvidence, CoinLink, PostCoinLink } from './api/index.ts';
import { formatUsd } from './format/number.ts';
import { tickerText } from './format/ticker.ts';

export type CoinAction =
  | { readonly kind: 'create' }
  | { readonly kind: 'buy'; readonly coin: Coin }
  | { readonly kind: 'view'; readonly count: number };

/** A feed card's buttons: the story actions, and the list of coins that use a post's name. */
export type PostAction = CoinAction | { readonly kind: 'see'; readonly count: number; readonly more: boolean };

export interface PostCoinStatus {
  readonly line: string;
  /** In the order they are drawn. Empty is no button at all, never a disabled one. */
  readonly actions: readonly PostAction[];
  /** For a post's own coin: why it is the post's, as facts (`evidenceFacts`). */
  readonly facts?: readonly string[];
}

export interface CoinStatus {
  readonly line: string;
  readonly action: CoinAction | null;
}

export function coinStatus(coins: PostCoinLink): CoinStatus {
  switch (coins.kind) {
    case 'none':
      return { line: 'No coin yet', action: { kind: 'create' } };
    case 'pending':
      return { line: '— still checking for a coin', action: null };
    case 'unchecked':
      return { line: "Couldn't check", action: null };
    case 'unsure':
      return { line: unsureLine(coins.claimCount, coins.more === true), action: null };
    case 'one':
    case 'matched':
      return coins.coin.tradable
        ? { line: '1 coin', action: { kind: 'buy', coin: coins.coin } }
        : { line: "1 coin, can't be traded yet", action: null };
    case 'several': {
      const venues = new Set(coins.coins.map((c) => c.venueLabel));
      const venue = venues.size === 1 ? ` on ${coins.coins[0].venueLabel}` : '';
      return { line: `${coins.coins.length} coins${venue}`, action: { kind: 'view', count: coins.coins.length } };
    }
  }
}

/** "3 coins use this name…", or "10+ coins…" when the search found more than it kept. */
function unsureLine(count: number, more: boolean): string {
  if (count === 1 && !more) return "A coin uses this name. We can't tell if it came from here.";
  return `${count}${more ? '+' : ''} coins use this name. We can't tell which one came from here.`;
}

/** "See 3 coins", "See 1 coin", "See 10+ coins": the real count, and "+" when there are more. */
export function seeCoinsLabel(count: number, more: boolean): string {
  return `See ${count}${more ? '+' : ''} ${count === 1 && !more ? 'coin' : 'coins'}`;
}

/**
 * A feed post's card: its line and its buttons. The same as `coinStatus` but for `unsure`, which
 * on a post offers the list of same-named coins and Create, and for `one`, whose line is the
 * ticker and market cap (`oneCoinLine`).
 */
export function postCoinStatus(coins: PostCoinLink): PostCoinStatus {
  if (coins.kind === 'unsure') {
    const more = coins.more === true;
    return {
      line: unsureLine(coins.claimCount, more),
      /* No list to open when nothing is listed: Create alone, never a "See 0 coins". */
      actions: coins.claimCount > 0 ? [{ kind: 'see', count: coins.claimCount, more }, { kind: 'create' }] : [{ kind: 'create' }],
    };
  }
  const status = coinStatus(coins);
  const one = coins.kind === 'one' || coins.kind === 'matched';
  return {
    line: one ? oneCoinLine(coins.coin) : status.line,
    actions: status.action === null ? [] : [status.action],
    ...(coins.kind === 'matched' ? { facts: evidenceFacts(coins.evidence) } : {}),
  };
}

/** Minutes, hours or days, the way the card says a gap: "12m", "3h", "2d". */
function gap(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 0)}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/**
 * WHY A COIN IS THE POST'S, AS FACTS: "Links this post", "Same picture", "The poster's bio names
 * this coin" (the poster put its address in their own profile), "Launched 12m after". Only facts that hold are said; an unknown is left out, never said as a "no". A coin launched
 * before the post says so, since that is the one fact that rules it out. Never a measure of how sure.
 *
 * ★ "Coin for this story" (the owner, 2026-10-14): the owner confirmed this coin on another post
 * about the same story. Said instead of "Links this post", never with it: when the post proves
 * the coin itself, the proof is what the card says.
 */
export function evidenceFacts(e: CoinEvidence): readonly string[] {
  const out: string[] = [];
  if (e.linksPost === true) out.push('Links this post');
  else if (e.storyCoin === true) out.push('Coin for this story');
  if (e.samePicture === true) out.push('Same picture');
  if (e.posterBio === true) out.push("The poster's bio names this coin");
  if (e.launchedAfterMs !== null) out.push(e.launchedAfterMs >= 0 ? `Launched ${gap(e.launchedAfterMs)} after` : `Launched ${gap(-e.launchedAfterMs)} before`);
  return out;
}

/**
 * The line a single post's card shows for its one confident coin: the ticker, the market cap
 * when it has been read (an unread cap is left out, never "$0"), and whether it can be traded.
 */
export function oneCoinLine(coin: Coin): string {
  const cap = formatUsd(coin.marketCapUsd);
  return `${tickerText(coin.ticker)}${cap.kind === 'value' ? `, ${cap.text} market cap` : ''}${coin.tradable ? '' : ", can't be traded yet"}`;
}

/** Every coin a story has settled on, in the server's order. `unsure` has none to give. */
export function settledCoins(coins: CoinLink): readonly Coin[] {
  switch (coins.kind) {
    case 'one':
      return [coins.coin];
    case 'several':
      return coins.coins;
    default:
      return [];
  }
}
