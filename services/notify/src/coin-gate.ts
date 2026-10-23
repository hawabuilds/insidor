/**
 * WHETHER A COIN MAY BE ANNOUNCED AT ALL: launched on the launchpad, and launched after the post. One gate for the two For You coin alerts (`fyp_coin` in pipeline.ts, `coin_launched` in
 * launch.ts), so they cannot drift into two answers to the same question.
 *
 * The owner, 2026-10-23: "should be showing me coins that are launched from pumpfun", and his
 * standing rule (memory app-goal): only the first coin that launched AFTER we had the post. On 23
 * Oct the list carried "$ANATOLY launched 7d before @mert's post", "$BRUNO launched 4d before…" and
 * "$Warhound has the name of @Polymarket's post" (no launch time): a coin older than the post is not
 * news, and a coin whose launch we cannot place is no claim that it came after.
 *
 * ★ THE LAUNCHPAD IS THE STORED ROW, NEVER THE ADDRESS. public.asset.venue_id is written by the
 * launchpad's adapter (adapters/venue/solana-pumpfun ids.ts) for the coins its socket and listing
 * see; its origin says the row is a seen launch (OBSERVED_ASSET_ORIGINS). The `pump` suffix is only
 * the launchpad's website's habit: measured 23 Oct, 21,070 of the last two days' socket launches had
 * no suffix and each opened at the launchpad's ~28 SOL curve price. A coin with no row is a coin we
 * cannot place on the launchpad, and is not announced.
 *
 * ★ "AFTER THE POST" IS THE POST'S OWN TIME (public.item.posted_at, our first sighting when that is
 * unknown). The owner, 2026-10-23, kept the list entry for a coin launched after the post but before
 * we found it ("$SLB launched 2h after @Dexerto's post"): it is still the post's coin, not an older
 * coin that shares a name. Only coins older than the post itself are left out.
 *
 * What breaks if changed carelessly: answering "unknown" as yes. A coin with no launch time, no
 * venue row, or a post with no sighting fails the gate; nothing here may default to letting it pass.
 */

import { OBSERVED_ASSET_ORIGINS } from '@insidor/contracts/asset.ts';

import type { Db } from './deliver.ts';

/** The launchpad's venue id as its adapter writes it (adapters/venue/solana-pumpfun ids.ts `VENUE_ID`). */
export const LAUNCHPAD_VENUE = 'solana:pumpfun';

/** What the gate reads about one post and one coin; null is "not known". */
export interface CoinGateFacts {
  readonly venueId: string | null;
  readonly origin: string | null;
  readonly launchedMs: number | null;
  /** When the post was made (our first sighting when its own time is unknown). */
  readonly hadPostMs: number | null;
}

export type CoinGateRefusal = 'not_launchpad' | 'launch_unknown' | 'launched_before_the_post';

/** Null when the coin may be announced, else why not. Pure. */
export function coinGate(f: CoinGateFacts): CoinGateRefusal | null {
  if (f.venueId !== LAUNCHPAD_VENUE || f.origin === null || !(OBSERVED_ASSET_ORIGINS as readonly string[]).includes(f.origin)) return 'not_launchpad';
  if (f.launchedMs === null || f.hadPostMs === null) return 'launch_unknown';
  return f.launchedMs >= f.hadPostMs ? null : 'launched_before_the_post';
}

const ms = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(n) ? n : null;
};

/** The gate's facts for each `item|address` pair, read from public.asset and public.item (both granted to notify). */
export async function coinGateFacts(db: Db, pairs: readonly { readonly itemId: string; readonly address: string }[]): Promise<Map<string, CoinGateFacts>> {
  const out = new Map<string, CoinGateFacts>();
  if (pairs.length === 0) return out;
  const items = [...new Set(pairs.map((p) => p.itemId))];
  const coins = [...new Set(pairs.map((p) => p.address))];
  const assets = new Map(
    (await db.query<{ address: string; venue_id: string; origin: string | null; minted_at: unknown }>(`select address, venue_id, origin, minted_at from public.asset where chain = 'solana' and address = any($1::text[])`, [coins])).map((a) => [a.address, a] as const),
  );
  const had = new Map((await db.query<{ item_id: string; at: unknown }>(`select item_id, coalesce(posted_at, first_seen_at) as at from public.item where item_id = any($1::text[])`, [items])).map((i) => [i.item_id, ms(i.at)] as const));
  for (const p of pairs) {
    const a = assets.get(p.address);
    out.set(`${p.itemId}|${p.address}`, { venueId: a?.venue_id ?? null, origin: a?.origin ?? null, launchedMs: ms(a?.minted_at), hadPostMs: had.get(p.itemId) ?? null });
  }
  return out;
}
