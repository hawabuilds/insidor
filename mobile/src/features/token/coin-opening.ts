/**
 * WHERE A COIN TAP GOES: the one rule for every coin row inside a narrative or a post — the post
 * sheet's coin, Choose coin (a card's "See N coins"), a For You card's coin line, and a narrative
 * link that has gone stale.
 *
 * ★ A COIN TAP ALWAYS OPENS THE COIN'S TOKEN PAGE (the owner, 2026-10-14). "If the read has a
 * story, the story decides" governs which coins a story LISTS and which coin it puts its name
 * above; it never decides whether a coin's own page can open. So:
 *   - a coin the narrative settled on opens the narrative's page for it (TokenPage);
 *   - any other coin opens on its own facts by its id (SearchedToken), no narrative named above it;
 *   - a coin the post has NOT proven says so as one small grey line on that page (NOT_PROVEN).
 * Nothing here returns a refusal. The old "not one this narrative has settled on" dead end was a
 * Choose coin tap being sent to the narrative's page for a coin the narrative never chose.
 *
 * Its own file so the rule is tested without drawing a page (the pages import CSS).
 *
 * What breaks if changed carelessly: sending an unproven coin to the narrative's page would put
 * the narrative's title and lead post above a coin it never chose; dropping `unproven` loses the
 * line that keeps a same-name coin from looking like the post's own.
 */

import type { Coin, Story } from '../../shared/api/index.ts';
import { settledCoins } from '../../shared/coin-status.ts';
import type { Route } from '../../shared/route.ts';

/** The grey line under a coin the post has not proven. A fact about the post, never how sure. */
export const NOT_PROVEN = 'Not proven from this post.';

export type CoinOpening =
  | { readonly kind: 'loading' }
  /** A coin the narrative settled on: the narrative's page for it. */
  | { readonly kind: 'narrative'; readonly story: Story; readonly coin: Coin }
  /** Any other coin, or a narrative that could not be read: the coin's own page by its id. */
  | { readonly kind: 'own' };

type StoryLoad = { readonly state: 'loading' } | { readonly state: 'failed' } | { readonly state: 'ready'; readonly value: Story };

/** What `#/story/<id>/coin/<id>` shows. Never a refusal: a coin the story did not choose opens as itself. */
export function coinOpening(story: StoryLoad, coinId: string): CoinOpening {
  if (story.state === 'loading') return { kind: 'loading' };
  if (story.state === 'failed') return { kind: 'own' };
  const coin = settledCoins(story.value.coins).find((c) => c.coinId === coinId);
  return coin !== undefined ? { kind: 'narrative', story: story.value, coin } : { kind: 'own' };
}

/**
 * A post sheet coin's page (the sheet's coin row and every Choose coin row). The post's proven
 * coin opens with its narrative around it when the post has one; any other opens by its own id,
 * marked `unproven` so its page carries the grey line.
 */
export function sheetCoinRoute(coin: { readonly coinId: string; readonly proven: boolean }, storyId: string | null): Route {
  if (!coin.proven) return { screen: 'token', coinId: coin.coinId, unproven: true };
  return storyId !== null ? { screen: 'coin', storyId, coinId: coin.coinId } : { screen: 'token', coinId: coin.coinId };
}
