/**
 * THE RUNNING PICK ON FOR YOU (Policy.runnerLink.running): a post whose one coin is trading now is
 * on For You whatever its views — the coin pulls its post back.
 *
 * Its own file because it is a fourth way past For You's gates beside the view bar, the coin's vouch
 * and the coin-first route (rising.ts), with its own read — each recent pick's coin and that coin's
 * newest market reading — and its own test of "running", which is the running coins strip's
 * (Policy.runningCoins: the last hour's dollars and trades) or a cap of `running.minCapUsd`.
 *
 * The miss that made it (23 Oct): @Na1_N1ako's post, which stated "You Missed Coin" $BITCHES, reached
 * For You on its coin's vouch and left it 46 seconds later at 21 views; @TocRadio's origin post, 84.5k
 * views, never got on at all. The coin ran to millions. A post whose coin runs is the post people are
 * about to look for, whatever its own count says.
 *
 * What it lets past: the view bar, the six hours, the junk bar and the order model's score bar — the
 * coin stands in for all of them, as the coin-first route's does. And the held kind (a POLITICS or
 * SHOWBIZ answer of the kind question): the coin trading is a fact about the world, and the post
 * cannot be the coin's and not be news. What it does not let past: the judge's yes on the first
 * question (at least once — the newest answer may be the kind's), the owner's "Not a meme", his "No
 * coin is from this" or a coin he called wrong, the variety rule, the cut. Only in
 * Policy.oneCoin.mode 'live', where the pick is the card's coin.
 *
 * ★ A READING THAT IS OLD OR MISSING IS NOT A RUNNING COIN. Older than `running.readingWithinMs`, or
 * with no last hour recorded, the hour test cannot pass; the cap test still reads the newest cap.
 * An absence never counts as trading, and never as zero either: it just does not pull.
 *
 * ★ ONE POST A COIN. A coin that runs is picked for every post that named it — 92 posts held $Kimchi
 * on 21-24 Oct — and only one of them is the post to pull back: the most seen, then the earliest.
 * Replayed over the three days to 24 Oct, the route pulls back 45 posts (one per running coin) that
 * For You never showed; without the rule it was 248.
 *
 * ★ A PROMOTION'S PICK PULLS ITS ORIGINAL (promotions.ts, Policy.rising.promotion). A coin picked for
 * a post that only points at another account's bigger post pulls back that original instead, on the
 * original's own judge's yes — and an original older than the coin-link age only while the coin runs
 * by the saved-post bars. Moved before the one-post-a-coin choice, so the original competes for the
 * coin as its promotion would have.
 *
 * What breaks if changed carelessly: the judge's yes. Without it a copycat picked for any post the
 * matcher once met would put that post on For You the moment the copycat traded.
 */

import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import type { Db } from '@insidor/store';

import { carries, type PromotedPick } from './promotions.ts';

/** A recent pick's coin and its newest reading. Every absent fact is null. */
export interface RunningPickRow {
  readonly itemId: string;
  readonly address: string;
  /** The judge's first question said yes at least once. */
  readonly judgedYes: boolean;
  readonly capUsd: number | null;
  readonly volume1hUsd: number | null;
  readonly trades1h: number | null;
  readonly readAtMs: number | null;
}

/** Whether the coin is running now: the strip's last-hour test on a fresh reading, or the cap bar. */
export function isRunning(r: Pick<RunningPickRow, 'capUsd' | 'volume1hUsd' | 'trades1h' | 'readAtMs'>, nowMs: number, policy: Policy = DEFAULT_POLICY): boolean {
  if (r.readAtMs === null || nowMs - r.readAtMs > policy.runnerLink.running.readingWithinMs) return false;
  const hour = r.volume1hUsd !== null && r.trades1h !== null && r.volume1hUsd >= policy.runningCoins.minVolume1hUsd && r.trades1h >= policy.runningCoins.minTrades1h;
  return hour || (r.capUsd !== null && r.capUsd >= policy.runnerLink.running.minCapUsd);
}

/** The owner's word and the post's own facts the route reads in a frame. */
export interface RunningPost {
  readonly ownerNotMeme: boolean;
  readonly ownerNone: boolean;
  readonly wrong: ReadonlySet<string>;
}

/** Whether the running pick lets this post onto For You now. */
export function runningLets(row: RunningPickRow | undefined, p: RunningPost, nowMs: number, policy: Policy = DEFAULT_POLICY): boolean {
  if (row === undefined || !row.judgedYes || p.ownerNotMeme || p.ownerNone || p.wrong.has(row.address)) return false;
  return isRunning(row, nowMs, policy);
}

/** Whether the route is in force. */
export const runningOn = (policy: Policy = DEFAULT_POLICY): boolean => policy.runnerLink.running.on && policy.oneCoin.mode === 'live';

const num = (x: unknown): number | null => (x === null || x === undefined ? null : Number.isFinite(Number(x)) ? Number(x) : null);

/**
 * The posts picked a coin within `running.pickWithinMs` whose coin is running now (or only these
 * posts', for a frame over a few), keyed by post. Empty when the route is off or before 0113.
 */
export async function loadRunningPicks(
  db: Db,
  nowMs: number,
  policy: Policy = DEFAULT_POLICY,
  only: readonly string[] | null = null,
  /** The recent picks on promotions, by the promotion (promotions.ts): each moves to its original. */
  promoted: ReadonlyMap<string, PromotedPick> = new Map(),
): Promise<ReadonlyMap<string, RunningPickRow>> {
  if (!runningOn(policy)) return new Map();
  let rows: { item_id: string; address: string; judged_yes: boolean; cap: unknown; vol: unknown; trades: unknown; at: string | Date | null; reach: unknown; posted: string | Date | null }[];
  try {
    rows = await db.query(
      `select p.item_id, p.address,
              exists (select 1 from internal.post_judgement j where j.item_id = p.item_id and j.coinable is true and j.prompt_id not like 'post-kind%') as judged_yes,
              r.market_cap_usd as cap, r.volume_1h_usd as vol, (r.buys_1h + r.sells_1h) as trades, r.taken_at as at,
              (select max(o.value) from public.observation o where o.item_id = p.item_id and o.kind = 'reach') as reach,
              (select coalesce(i.posted_at, i.first_seen_at) from public.item i where i.item_id = p.item_id) as posted
         from internal.post_coin_pick p
         join public.asset a on a.address = p.address
         left join lateral (select m.market_cap_usd, m.volume_1h_usd, m.buys_1h, m.sells_1h, m.taken_at from public.market_reading m
                             where m.asset_key = a.asset_key order by m.taken_at desc limit 1) r on true
        where p.outcome = 'picked' and p.updated_at >= $1`,
      [new Date(nowMs - policy.runnerLink.running.pickWithinMs).toISOString()],
    );
  } catch {
    return new Map();
  }
  /* ★ ONE POST A COIN: the most seen of the posts the coin is picked for, then the earliest. */
  const best = new Map<string, { row: RunningPickRow; reach: number; at: number }>();
  for (const r of rows) {
    /* ★ A promotion's pick is its original's, or nobody's while an old original's coin is not running. */
    const moved = promoted.get(r.item_id);
    if (moved !== undefined && !carries(moved)) continue;
    const row: RunningPickRow = {
      itemId: moved?.original.itemId ?? r.item_id, address: r.address, judgedYes: moved?.originalJudgedYes ?? r.judged_yes,
      capUsd: num(r.cap), volume1hUsd: num(r.vol), trades1h: num(r.trades), readAtMs: r.at === null ? null : new Date(r.at).getTime(),
    };
    if (!row.judgedYes || !isRunning(row, nowMs, policy)) continue;
    const reach = (moved === undefined ? num(r.reach) : moved.original.reach) ?? Number.NEGATIVE_INFINITY;
    const postedMs = moved === undefined ? (r.posted === null ? null : new Date(r.posted).getTime()) : moved.original.postedAtMs;
    const at = postedMs ?? Number.POSITIVE_INFINITY;
    const had = best.get(row.address);
    if (had === undefined || reach > had.reach || (reach === had.reach && (at < had.at || (at === had.at && row.itemId < had.row.itemId)))) best.set(row.address, { row, reach, at });
  }
  /* Chosen over every recent pick, then narrowed: a frame over a few posts must pull back the same post the full frame does. */
  const keep = only === null ? null : new Set(only);
  return new Map([...best.values()].filter(({ row }) => keep === null || keep.has(row.itemId)).map(({ row }) => [row.itemId, row] as const));
}
