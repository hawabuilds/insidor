/**
 * A POST'S REPLIES AND QUOTE POSTS, READ THROUGH THE SAME ADVANCED SEARCH AS DISCOVERY.
 *
 * Two queries per post: `conversation_id:<id>` for the replies (every post in the post's thread,
 * replies to replies included) and `quoted_tweet_id:<id>` for the quote posts. Both are the
 * vendor's search operators, measured working on 2026-10-13 against a gold origin post (20 replies
 * and 19 quotes on the first page each). `until_time:` bounds both when the caller asks for
 * responses before an instant, rendered exactly as discovery renders its cutoff.
 *
 * Its own file because it is a separate read with a separate purpose (the crypto-attention facts,
 * core/src/qualify/attention.ts) and a separate ledger label (`responses`), while sharing the one
 * search call, its error handling and its pinned `Latest` order with discovery. Translation only:
 * which words count as crypto is core's question, not this file's.
 *
 * ★ THE ACCOUNT'S PROFILE TEXT IS `author.profile_bio.description`. The plain `author.description`
 * came back empty on all 39 posts of the first measurement while the nested one carried the
 * profile, so the nested field is read first and the flat one is the fallback.
 *
 * ★ NEWEST FIRST, CAPPED, AND THE CAP IS SAID. `Latest` returns the newest responses; reading
 * stops at the cap and `cut` records that the vendor had more. A capped read of a busy post is
 * the newest N, never the first N — a caller wanting the earliest responses must pass `untilMs`.
 *
 * What breaks if changed carelessly: every page is metered on its own, with the vendor's
 * per-request floor, because a page that came back empty is still billed. The thread's own root
 * post is answered by the conversation query too and is dropped here: it is not a reply to itself.
 */

import type { Millis } from '@insidor/contracts';
import type { Meter, Metered, CostEstimate, Spend } from '@insidor/contracts/ports/meter.ts';
import type { PostResponses, ResponseAsk, ResponsePost } from '@insidor/contracts/ports/responses.ts';
import { estimateFor, mergeSpend, metered } from '@insidor/meter';
import type { PriceBook } from '@insidor/meter';
import { dateToMillis, rec, str } from '@insidor/vendor-kit';

import { billedUnits, RESPONSES, VENDOR } from './capabilities.ts';
import { isPostId, type XClient } from './client.ts';
import { cutoffSecond } from './discover.ts';

/** The vendor's documented page size for advanced search; used only to price an ask. */
export const SEARCH_PAGE_SIZE = 20;

/** The search for one kind of response, with the cutoff when there is one. */
export function responseQuery(kind: 'replies' | 'quotes', postId: string, untilMs: Millis | null): string {
  if (!isPostId(postId)) throw new RangeError(`x responses: '${postId.slice(0, 64)}' is not a post id on this source`);
  const base = kind === 'replies' ? `conversation_id:${postId}` : `quoted_tweet_id:${postId}`;
  return untilMs === null ? base : `${base} until_time:${cutoffSecond(untilMs)}`;
}

/** One vendor post as a response. Null when it carries no id: nothing to key it by. */
export function toResponse(raw: unknown): ResponsePost | null {
  const r = rec(raw);
  const id = str(r.id) ?? str(r.id_str);
  if (id === null) return null;
  const author = rec(r.author);
  return {
    sourceItemId: id,
    at: (dateToMillis(r.createdAt) ?? dateToMillis(r.created_at)) as Millis | null,
    text: str(r.text) ?? '',
    authorHandle: (str(author.userName) ?? str(author.screen_name))?.replace(/^@+/, '') ?? null,
    authorName: str(author.name),
    authorBio: str(rec(author.profile_bio).description) ?? str(author.description),
  };
}

/** Pages one query until `max` responses, the vendor's last page, or an empty page. */
async function readKind(
  client: XClient,
  meter: Meter,
  prices: PriceBook,
  query: string,
  skipId: string,
  max: number,
  at: Millis,
): Promise<{ readonly posts: readonly ResponsePost[]; readonly cut: boolean; readonly spends: readonly Spend[] }> {
  const posts: ResponsePost[] = [];
  const spends: Spend[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let more = true;
  while (more && posts.length < max) {
    const result: Metered<{ items: readonly unknown[]; cursor: string | null; hasMore: boolean }> = await metered(
      meter,
      prices,
      { vendor: VENDOR, endpoint: RESPONSES, unit: 'per-item-returned', estUnits: SEARCH_PAGE_SIZE, at },
      async () => {
        const page = await client.search(query, cursor);
        return { value: page, units: billedUnits(page.items.length) };
      },
    );
    spends.push(result.spend);
    for (const raw of result.value.items) {
      const post = toResponse(raw);
      if (post === null || post.sourceItemId === skipId || seen.has(post.sourceItemId)) continue;
      seen.add(post.sourceItemId);
      posts.push(post);
    }
    more = result.value.hasMore && result.value.cursor !== null && result.value.items.length > 0;
    cursor = result.value.cursor;
  }
  return { posts: posts.slice(0, max), cut: more || posts.length > max, spends };
}

/** A post's replies and quote posts, each capped by `ask`, metered page by page. */
export async function readResponses(
  client: XClient,
  meter: Meter,
  prices: PriceBook,
  postId: string,
  ask: ResponseAsk,
  at: Millis,
): Promise<Metered<PostResponses>> {
  const replies = ask.maxReplies > 0
    ? await readKind(client, meter, prices, responseQuery('replies', postId, ask.untilMs), postId, ask.maxReplies, at)
    : { posts: [], cut: false, spends: [] };
  const quotes = ask.maxReproductions > 0
    ? await readKind(client, meter, prices, responseQuery('quotes', postId, ask.untilMs), postId, ask.maxReproductions, at)
    : { posts: [], cut: false, spends: [] };
  const spends = [...replies.spends, ...quotes.spends];
  return {
    value: { replies: replies.posts, reproductions: quotes.posts, repliesCut: replies.cut, reproductionsCut: quotes.cut },
    spend: mergeSpend(spends, { vendor: VENDOR, endpoint: RESPONSES, unit: 'per-item-returned', estUnits: 0, at }, 'per-item-returned'),
  };
}

/** The most an ask can cost: every page full, each kind rounded up to whole pages. */
export function estimateResponses(prices: PriceBook, ask: ResponseAsk): CostEstimate {
  const pages = (n: number) => (n <= 0 ? 0 : Math.ceil(n / SEARCH_PAGE_SIZE));
  return estimateFor(prices, VENDOR, RESPONSES, (pages(ask.maxReplies) + pages(ask.maxReproductions)) * SEARCH_PAGE_SIZE);
}
