/**
 * GET /post/:id/names — the Create sheet's name chips for a post, each with whether its ticker
 * is free; and GET /ticker/:symbol/coins — the coins already using a ticker, what "Taken by 3
 * coins" opens.
 *
 * WHERE THE NAMES COME FROM: the projector (public.post_name_idea, 0058), from the judge's own
 * names for the post's subject — no call is made here to make them. WHETHER A TICKER IS TAKEN:
 * asked when a person opens Create, from our name index (public.coin_name, every launch the mint
 * stream saw) and the two free market sources, searched by the ticker through the same
 * one-minute cache and per-client limit as Search (search.ts). A coin counts when its ticker is
 * exactly this one, ignoring case.
 *
 * ★ THREE ANSWERS, NOT TWO, as core's `tickerUse` says for the same reason. `taken` with how
 * many coins; `free` only when the index has none AND every source answered with none; and
 * `unknown` when a source was down and nothing was found — finding nothing in a search that did
 * not run is not evidence nobody launched. Never "Free" on an outage.
 *
 * ★ THE ORDER IS FREE FIRST, then unknown, then taken, each keeping the projector's order (the
 * subject's own one-word name first). Sorting is done here, once, so the chips never re-sort.
 *
 * What breaks if changed carelessly: the 404 when the post has no ideas. An empty 200 would let
 * the sheet show "no ideas" for a post the projector has not reached, which is a claim about
 * the judge's answer we have not read.
 */

import type { CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';

import type { Row } from './queries.ts';

/** A shown post's ideas, in the projector's order. Only while the post is on a feed. */
export const NAME_IDEAS_SQL = `
select i.position, i.name, i.ticker
  from public.post_name_idea i
 where i.item_id = $1
   and exists (select 1 from public.rising_row r where r.item_id = i.item_id)
 order by i.position`;

/** The index's coins under a ticker, newest first, at most $2. */
export const TICKER_COINS_SQL = `
select n.address, n.ticker as symbol, n.name, a.image_uri, coalesce(a.minted_at, n.launched_at) as minted_at
  from public.coin_name n
  left join public.asset a on a.chain = 'solana' and a.address = n.address
 where upper(n.ticker) = upper($1)
 order by coalesce(a.minted_at, n.launched_at) desc nulls last, n.address
 limit $2`;

/** The most coins a "Taken by" list shows; past it the count says "+". */
export const TICKER_COINS_SHOWN = 30;

export type TickerUse = { readonly kind: 'free' } | { readonly kind: 'taken'; readonly count: number; readonly more: boolean } | { readonly kind: 'unknown' };

export interface NameIdeaReply {
  readonly name: string;
  readonly ticker: string;
  readonly use: TickerUse;
}

export function ideasFrom(rows: readonly Row[]): readonly { readonly name: string; readonly ticker: string }[] {
  return rows.flatMap((r) => (typeof r['name'] === 'string' && typeof r['ticker'] === 'string' ? [{ name: r['name'], ticker: r['ticker'] }] : []));
}

/** The coins under exactly this ticker: the index's addresses and the sources' hits, as one set. */
export function tickerAddresses(ticker: string, indexed: readonly string[], hits: readonly CoinSearchHit[]): ReadonlySet<string> {
  const t = ticker.toUpperCase();
  return new Set([...indexed, ...hits.filter((h) => (h.ticker ?? '').toUpperCase() === t).map((h) => h.address)]);
}

/** The rule in the header: taken with the count, free only with every source answering, else unknown. */
export function tickerUse(addresses: ReadonlySet<string>, sourcesFailed: number, capped: boolean): TickerUse {
  if (addresses.size > 0) return { kind: 'taken', count: addresses.size, more: capped };
  return sourcesFailed > 0 ? { kind: 'unknown' } : { kind: 'free' };
}

const RANK: Record<TickerUse['kind'], number> = { free: 0, unknown: 1, taken: 2 };

/** Free first, then unknown, then taken, each in the projector's order (a stable sort). */
export function freeFirst(ideas: readonly NameIdeaReply[]): readonly NameIdeaReply[] {
  return [...ideas].sort((a, b) => RANK[a.use.kind] - RANK[b.use.kind]);
}
