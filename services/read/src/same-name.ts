/**
 * GET /post/:id/coins — the coins an unsure feed post shares its name with: what "See 3 coins"
 * opens. Each coin as Search shows it (search.ts): picture, ticker, market cap, launch, and
 * "On curve x%" or "Bonded".
 *
 * WHICH COINS: exactly the rows the projector committed beside the post (public.same_name_coin,
 * 0051) — the narrative's when the post is on an unsure narrative, else the post's own search —
 * and only while the post is on a feed and still unsure. The card's count is the length of that
 * same list, so the button and the sheet cannot disagree about how many. A post that is not
 * unsure is a 404: there is nothing to list, and a list here would be a second answer beside the
 * card's.
 *
 * WHERE THE MARKET NUMBERS COME FROM: the market data sources, searched live by the coins' own
 * names — the same call Search makes, so the numbers on this list and on Search agree. No new
 * table and no new source; this process is the one that already holds both, and the projector
 * cannot hold a curve's progress, which moves trade by trade.
 *
 * ★ A LIST, NEVER A LINK. Nothing here says which coin is the post's. Each coin opens its own
 * page, where a person may buy it as from Search; the feed card keeps no Buy button.
 *
 * What breaks if changed carelessly: a coin no source listed has no market anyone reports —
 * `venue: null`, its cap a dash with why — never a cap of zero. An outage on every source is
 * said (`sourcesMissing`), and the coins are still listed with what we hold of them.
 */

import type { CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';

import type { Row } from './queries.ts';

/**
 * The post's list, if it is on a feed and unsure. One row per coin we hold by name (0037's index
 * outlives a coin's full row); a post that is unsure with nothing we can list is one row with a
 * null address, so "on a feed, unsure, empty" is told apart from "not here".
 */
export const SAME_NAME_SQL = `
with post as (
  select payload from public.rising_row
   where item_id = $1 and payload #>> '{coins,kind}' = 'unsure'
   limit 1
)
select n.address, coalesce(a.symbol, n.ticker) as symbol, coalesce(a.name, n.name) as name, a.image_uri,
       coalesce(a.minted_at, n.launched_at) as minted_at, (p.payload #>> '{coins,more}') = 'true' as more
  from post p
  left join public.same_name_coin c
    on (p.payload ->> 'storyId' is not null and c.subject_kind = 'story' and c.subject_id = p.payload ->> 'storyId')
    or (p.payload ->> 'storyId' is null and c.subject_kind = 'post' and c.subject_id = $1)
  left join public.coin_name n on n.address = c.address
  left join public.asset a on a.chain = 'solana' and a.address = n.address`;

/**
 * Distinct names searched per list. The coins on one list share a name by construction, so one
 * or two searches find them all; three bounds a list whose coins spell it differently, and a
 * coin past them shows a dash for its market, never a guess.
 */
export const NAMES_SEARCHED = 3;

/** A coin on the list, as we hold it: its address, what it is called, its picture and launch. */
export interface HeldCoin {
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly imageUrl: string | null;
  readonly launchedAt: number | null;
}

/** The post's list from the rows, and whether its count is "at least"; null when the post is not here. */
export function heldCoins(rows: readonly Row[]): { readonly coins: readonly HeldCoin[]; readonly more: boolean } | null {
  if (rows.length === 0) return null;
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  const coins = rows.flatMap((r): HeldCoin[] => {
    const address = str(r['address']);
    if (address === null) return [];
    const minted = r['minted_at'] instanceof Date ? r['minted_at'].getTime() : typeof r['minted_at'] === 'string' ? Date.parse(r['minted_at']) : null;
    return [{ address, name: str(r['name']), ticker: str(r['symbol']), imageUrl: str(r['image_uri']), launchedAt: minted !== null && Number.isFinite(minted) ? minted : null }];
  });
  return { coins, more: rows.some((r) => r['more'] === true) };
}

/** The names to search the market by: the coins' own names, then tickers, most shared first. */
export function namesToSearch(coins: readonly HeldCoin[], max = NAMES_SEARCHED): readonly string[] {
  const counts = new Map<string, number>();
  for (const c of coins) {
    const term = (c.name ?? c.ticker ?? '').trim();
    if (term === '') continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([t]) => t);
}

/**
 * Each held coin with what a market source said about it, when one listed it. The source's
 * picture is not the coin's: only ours, or none.
 */
export function withMarket(coins: readonly HeldCoin[], hits: ReadonlyMap<string, CoinSearchHit>): readonly { readonly held: HeldCoin; readonly hit: CoinSearchHit | null }[] {
  return coins.map((held) => ({ held, hit: hits.get(held.address) ?? null }));
}
