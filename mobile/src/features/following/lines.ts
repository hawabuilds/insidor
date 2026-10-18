/**
 * WHAT THE FEED OF PEOPLE WRITES, apart from the screen so `node --test` holds it: a trade's
 * second line, where a comment was said and where it opens, a person's name, and the counts under
 * someone to follow.
 *
 * ★ EVERY WORD IS A FACT OR NOTHING. No amounts, as Trador; a buy with no market cap that close to
 * its landing, or a sell with no known average buy, has no second line. A person who does not share trades has no
 * trade count at all, never "0 trades". A coin we never saw is its shortened address, never a
 * made-up name.
 *
 * What breaks if changed carelessly: `mergePage` drops an item already shown by its key, which is
 * what keeps a refresh racing Load more from showing one trade twice.
 */

import type { FeedCoin, FeedComment, FeedItem, FeedTrade, SuggestedPerson } from '../../shared/api/following.ts';
import type { PersonRef } from '../../shared/api/people.ts';
import { compactMoney } from '../../shared/format/number.ts';
import { hrefFor } from '../../shared/route.ts';

/**
 * A trade's second line, Trador's `detail()`: where a buy stood ("at $48K market cap"), or how a
 * sell went ("in profit", "at a loss"). Null rather than filler when neither can be said.
 */
export function tradeDetail(t: Pick<FeedTrade, 'side' | 'marketCapUsd' | 'outcome'>): string | null {
  if (t.side === 'buy') return t.marketCapUsd !== null && t.marketCapUsd > 0 ? `at $${compactMoney(t.marketCapUsd)} market cap` : null;
  if (t.outcome === 'profit') return 'in profit';
  if (t.outcome === 'loss') return 'at a loss';
  return null;
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** A coin's ticker, its name, or its shortened address: what we know, in that order. */
export const coinLabel = (c: FeedCoin): string => (c.symbol !== null && c.symbol !== '' ? c.symbol : c.name !== null && c.name !== '' ? c.name : short(c.mint));

/** A person as the row names them: their name, their @handle, or "Someone". */
export const nameOf = (p: Pick<PersonRef, 'name' | 'handle'>): string => p.name ?? (p.handle !== null ? `@${p.handle}` : 'Someone');

export const profileHref = (p: Pick<PersonRef, 'handle' | 'userId'>): string => hrefFor({ screen: 'profile', key: p.handle ?? p.userId });

export const coinHref = (mint: string): string => hrefFor({ screen: 'token', coinId: `solana:${mint}` });

/** Where a comment was said, and where it opens: the coin's page, or the page of its posts. */
export function whereOf(c: FeedComment): { readonly label: string; readonly href: string | null; readonly coin: FeedCoin | null } {
  const on = c.on;
  if (on.kind === 'coin' && on.coin !== null) return { label: coinLabel(on.coin), href: coinHref(on.coin.mint), coin: on.coin };
  const href = on.storyId !== null ? hrefFor({ screen: 'story', storyId: on.storyId }) : null;
  const label = on.title ?? (on.kind === 'post' ? 'a post' : 'a narrative');
  return { label: on.kind === 'post' && on.title !== null ? `a post in ${on.title}` : label, href, coin: null };
}

/** The counts under someone to follow, the ones they have, in a sentence. */
export function peopleFacts(p: SuggestedPerson): string {
  const week: string[] = [];
  if (p.tradesThisWeek !== null && p.tradesThisWeek > 0) week.push(`${p.tradesThisWeek} ${p.tradesThisWeek === 1 ? 'trade' : 'trades'}`);
  if (p.likesThisWeek > 0) week.push(`${p.likesThisWeek} ${p.likesThisWeek === 1 ? 'like' : 'likes'} from holders`);
  if (p.commentsThisWeek > 0) week.push(`${p.commentsThisWeek} ${p.commentsThisWeek === 1 ? 'comment' : 'comments'}`);
  const followers = `${p.followers.toLocaleString('en-US')} ${p.followers === 1 ? 'follower' : 'followers'}`;
  return week.length === 0 ? followers : `${week.join(', ')} this week, ${followers}`;
}

/** The rows already shown, then the next page's rows not among them. */
export function mergePage(held: readonly FeedItem[], next: readonly FeedItem[]): readonly FeedItem[] {
  const keys = new Set(held.map((i) => i.key));
  return [...held, ...next.filter((i) => !keys.has(i.key))];
}
