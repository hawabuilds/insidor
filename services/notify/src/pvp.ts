/**
 * PVP: A COIN YOU HOLD JUST FELL BEHIND ANOTHER COIN MADE FOR THE SAME POST (the owner, 2026-10-26,
 * $Marvin: "someone could have bought the wrong Marvin and went about their day without knowing
 * there was PvP").
 *
 * A post's pick keeps the coins made for it that are being bought together (`racing` on
 * internal.post_coin_pick, core coin-race.ts). For each coin a person holds that is one of those,
 * the first time another of them is worth more, they are told once: "PvP: the other $MARVIN just
 * passed yours". On 25 Oct that was 02:12, nine minutes before the leader crashed and the pick moved.
 *
 * Filed as `holding_down` (it is news about a holding going the wrong way, under the same switch)
 * with its own subject per pair, `pvp:<held>|<rival>`, so it never spends the real "down 50%"
 * alert and each rival is said once, ever.
 *
 * Its own file because the market loop (market.ts) reads balances and quotes, and this needs the
 * picks and the caps; both read here, free, from our own tables. Without the grant on the pick
 * table nothing is read and nothing is said.
 *
 * What breaks if changed carelessly: the cap comparison. Both caps must be fresh readings of the
 * same moment; an old reading of the held coin against a new one of the rival would cry PvP on a
 * coin that had already come back.
 */

import type { Db } from './deliver.ts';

/** One pass's news for one held coin: the rival that passed it, and both caps. */
export interface PvpPassed {
  readonly held: string;
  readonly heldSymbol: string;
  readonly heldCapUsd: number;
  readonly rival: string;
  readonly rivalSymbol: string;
  readonly rivalCapUsd: number;
  readonly itemId: string;
}

/** How fresh both caps must be. */
const FRESH_MS = 10 * 60_000;
/** Picks written this recently: a PvP is the opening hours. */
const PICKS_WITHIN_MS = 3 * 60 * 60_000;

/** The rival that passed each held coin now, if any (the highest-cap one). */
export async function pvpPassed(db: Db, held: readonly string[]): Promise<readonly PvpPassed[]> {
  if (held.length === 0) return [];
  const [r] = await db.query<{ ok: boolean | null }>(
    `select case when to_regclass('internal.post_coin_pick') is null then false else has_table_privilege('internal.post_coin_pick', 'select') end as ok`,
  );
  if (r?.ok !== true) return [];
  const picks = await db.query<{ item_id: string; racing: unknown }>(
    `select item_id, evidence -> 'racing' as racing from internal.post_coin_pick
      where evidence ? 'racing' and updated_at >= now() - make_interval(secs => $1::double precision / 1000)`,
    [PICKS_WITHIN_MS],
  );
  const mine = new Set(held);
  const pairs: { item: string; held: string; rivals: string[] }[] = [];
  for (const p of picks) {
    const racing = Array.isArray(p.racing) ? p.racing.filter((a): a is string => typeof a === 'string') : [];
    for (const h of racing) if (mine.has(h)) pairs.push({ item: p.item_id, held: h, rivals: racing.filter((a) => a !== h) });
  }
  if (pairs.length === 0) return [];
  const addresses = [...new Set(pairs.flatMap((p) => [p.held, ...p.rivals]))];
  const caps = await db.query<{ address: string; symbol: string | null; cap: number | string | null }>(
    `select a.address, a.symbol,
            (select m.market_cap_usd from public.market_reading m
              where m.asset_key = a.asset_key and m.taken_at >= now() - make_interval(secs => $2::double precision / 1000)
              order by m.taken_at desc limit 1) as cap
       from public.asset a where a.address = any($1::text[])`,
    [addresses, FRESH_MS],
  );
  const capOf = new Map(caps.flatMap((c) => (c.cap === null || !Number.isFinite(Number(c.cap)) ? [] : [[c.address, Number(c.cap)] as const])));
  const symOf = new Map(caps.map((c) => [c.address, c.symbol ?? ''] as const));
  const out: PvpPassed[] = [];
  for (const p of pairs) {
    const mineCap = capOf.get(p.held);
    if (mineCap === undefined) continue;
    const ahead = p.rivals.flatMap((a) => { const c = capOf.get(a); return c !== undefined && c > mineCap ? [{ a, c }] : []; }).sort((x, y) => y.c - x.c)[0];
    if (ahead === undefined) continue;
    out.push({ held: p.held, heldSymbol: symOf.get(p.held) ?? '', heldCapUsd: mineCap, rival: ahead.a, rivalSymbol: symOf.get(ahead.a) ?? '', rivalCapUsd: ahead.c, itemId: p.item });
  }
  return out;
}

/** The alert's subject: one per held coin and rival, said once ever. */
export const pvpSubject = (held: string, rival: string): string => `pvp:${held}|${rival}`;
