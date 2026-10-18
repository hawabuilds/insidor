/**
 * WHAT THE BELL'S LIST SHOWS, AND WHAT THE BELL COUNTS (the owner's notification design,
 * 2026-10-18). The Feed tab is now the people you follow (features/following); the alert rows it
 * showed — new For You posts, new narratives, a narrative's coin, a coin matched to one you star —
 * are in Notifications with everything else, as in-app rows: the alert service lists them and never
 * pushes them. So Notifications shows every kind, newest first.
 *
 * ★ THE BELL COUNTS WHAT IS ABOUT YOU, OR REACHED YOUR PHONE. The in-app-only kinds arrive by the
 * hundred a day; counting them would keep the bell at "9+" and say nothing. `QUIET_KINDS` is the
 * phone's copy of the alert service's listed-only kinds (core LIST_ONLY with the old Feed kinds;
 * the app may not import core); one of them that was pushed is counted. A kind added later and left
 * off is counted, rather than hidden.
 *
 * Its own pure file because these rules are tested here without rendering.
 */

import { tickerText } from '../../shared/format/ticker.ts';

/** Listed in Notifications, never pushed, not counted on the bell (unless it was pushed). */
const QUIET_KINDS: readonly string[] = ['rising_post', 'narrative_promoted', 'narrative_coin', 'coin_matched', 'fyp_coin', 'fyp_proven', 'watch_coin'];

export const isQuiet = (kind: string): boolean => QUIET_KINDS.includes(kind);

/** The bell's number: unread rows about you, or that reached the phone. */
export const bellCount = (items: readonly { readonly kind: string; readonly unread: boolean; readonly pushed?: boolean }[]): number => items.filter((a) => a.unread && (!isQuiet(a.kind) || a.pushed === true)).length;

/** An alert's link as the app's own hash route (`/#/token/…` → `#/token/…`); the Feed when it has none. */
export const linkOf = (href: string): string => (href.startsWith('/') ? href.replace(/^\//, '') || '#/' : '#/');

/**
 * A title with its ticker picked out, for Trador's bold symbol: `["", "$FERRY", " graduated"]`.
 * The ticker is matched as written by the alert service (`$` and the symbol); a title without it
 * comes back whole.
 */
export function withTicker(title: string, symbol: string | null): readonly [string, string, string] {
  if (symbol === null || symbol === '') return [title, '', ''];
  const t = tickerText(symbol);
  const i = title.indexOf(t);
  return i < 0 ? [title, '', ''] : [title.slice(0, i), t, title.slice(i + t.length)];
}
