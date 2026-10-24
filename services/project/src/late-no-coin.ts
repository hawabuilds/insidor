/**
 * THE LATE ROUTE ON FOR YOU (Policy.lateNoCoin, the owner 2026-10-24: "show late posts that still
 * have no coin"): a post we found after For You's six hours had already closed on it, that the judge
 * said yes to and that cleared For You's views bar, joins For You while NO coin for it is running yet.
 *
 * Why it exists: the moustache-baby post (@MalconSxRD, posted 22 Oct 16:39 UTC) reached us 15 hours
 * late, was judged yes at 0.72 with 88,703 views, and never showed — For You turns away any post over
 * `rising.fypMaxAgeMs` old that is not still climbing fast, and the post was found by a dud coin's
 * link, so no catch-all lane had credited it either. Its running coin launched 28 hours after the
 * post. The goal is being first to coin a post or seeing its first coin; a post nobody has coined is
 * still that chance, however late we were to it.
 *
 * What it lets past: the six hours, and the need for a catch-all lane's credit (internal.item_found_by)
 * — a late post is loaded by its own query here. What it does not: the judge's own yes (never the
 * safety net's `net`), the kind hold, the owner's Not a meme, the views bar and the order model's score
 * bar (`byViews` in rising.ts), the junk bar, the variety rule and the one-account share. A post loaded
 * by this route alone is For You's only, never Popular's.
 *
 * ★ WHAT "A COIN FOR IT" MEANS HERE — the first time any of these is true, the route lets go:
 *   - a coin whose own link names the post (internal.coin_post_link), or that the origin check tied to
 *     it (internal.coin_origin, `COIN_ORIGIN_TIES`), traded at `oneCoin.minCapUsd` or more — the
 *     running rule's own bar. A dud copycat that linked the post and never traded does not count: the
 *     moustache post's first linking coin (07:10 UTC 23 Oct) never ran, its running coin did 13 hours
 *     later. A coin that never ran is no one's first coin;
 *   - the one-coin rule picked a coin for the post, or for the narrative it belongs to;
 *   - the coin-first route holds a coin for it (internal.coin_first_post, not a pointer);
 *   - the owner named a coin as the post's own ("This is the coin"; checked in rising.ts).
 * From then the post is in the normal coin flow: the coin-first route takes it if its coin is young
 * enough, and a post that already joined keeps its place on the scroll with the coin on its card, as
 * every For You post does (feed-members.ts: For You shows every post that ever made it).
 *
 * ★ AND IT LETS GO AT `maxPostAgeMs` after the post went up, coin or no coin. Replayed over 19-23 Oct
 * (tools/late-no-coin-replay.ts): of the late posts it would have shown, the ones that got a running coin
 * got it 8 to 70 hours after the post; a week's cap instead of three days added 49 posts for one more coin.
 *
 * ★ ITS YES MAY SIT JUST UNDER THE BAR (`lateNoCoin.nearBar`, `lateAnswerPolicy`): the moustache post's
 * 0.72 on a video frame is under For You's 0.75. A yes up to `rising.boostBarMargin` under counts here
 * — the margin the picture boost already grants — and here only: such a post never joins by For You's
 * other gates, never by the coin-first route, never on Popular.
 *
 * ★ WHERE IT SHOWS. For You is newest posted first, frame and scroll alike (the owner, 2026-10-17),
 * so a late post takes its place by when it went up — usually under the frame's sixty cards. Such a
 * post joins For You's list for good straight away (`beyondCap`): it is on the scroll at its place,
 * in Trending and Most viewed, and its first running coin is pushed like any For You post's
 * (services/notify launch.ts: the coin launched after the post was first on For You). The card says
 * nothing of being late: its age is its own posted time, and its coin line says what coin it has.
 *
 * Its own file because it is a fourth way onto For You beside the views, the coin's vouch and the
 * coin-first route, with its own read. What breaks if changed carelessly: dropping the running bar
 * from the coin check. Then the first copycat that links a post — and they come in dozens within a
 * minute of a meme's coin — would end the route before the real coin exists, which is the moustache
 * case exactly.
 */

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import type { Db } from '@insidor/store';

/** The origin check's statuses that tie a coin to a post (internal.coin_origin): the creator's link, our own match, or the post went viral after the coin. */
export const COIN_ORIGIN_TIES: readonly string[] = ['linked_by_creator', 'matched_by_insidor', 'viral_after_launch'];

/** One post found late, and when a coin for it was first running (null: none yet). */
export interface LateRecord {
  readonly itemId: string;
  readonly postedAtMs: number;
  readonly foundAtMs: number;
  readonly coinAtMs: number | null;
  readonly coinAddress: string | null;
}

/**
 * The policy a post's answer is held to on this route: the answer's own (judge-cutoff.ts), with each
 * confidence bar lowered by `rising.boostBarMargin` when `lateNoCoin.nearBar` — the margin the picture
 * boost already grants a yes just under its bar. Only the bars move: the kind hold, the name test, the
 * owner's call and the shill rule are the same rule as For You's.
 */
export function lateAnswerPolicy<P extends Policy>(answer: P, route: Policy = DEFAULT_POLICY): P {
  if (!route.lateNoCoin.nearBar) return answer;
  const margin = answer.rising.boostBarMargin;
  const bars = answer.qualify.minJudgeConfidence;
  const lowered = Object.fromEntries(Object.entries(bars).map(([k, v]) => [k, v - margin])) as typeof bars;
  return { ...answer, qualify: { ...answer.qualify, minJudgeConfidence: lowered } };
}

/** Whether the route is in force. */
export const lateOn = (policy: Policy = DEFAULT_POLICY): boolean => policy.lateNoCoin.on;

/**
 * Whether a post found late is still the route's at `nowMs`: posted inside `maxPostAgeMs`, found
 * after For You's six hours had closed, and no coin for it running yet. The judge, the views bar and
 * the owner's word are rising.ts's, read per post in the frame.
 */
export function lateHolds(r: LateRecord, nowMs: number, policy: Policy = DEFAULT_POLICY): boolean {
  if (nowMs - r.postedAtMs > policy.lateNoCoin.maxPostAgeMs) return false;
  if (r.foundAtMs - r.postedAtMs <= policy.rising.fypMaxAgeMs) return false;
  return r.coinAtMs === null || r.coinAtMs > nowMs;
}

/**
 * The read behind `loadLate`, exported so a tool can ask the database how it runs it. Driven by the
 * judge's answers since `$1` (indexed by time): a post found since then was judged since then.
 */
export const LATE_SQL = `with yes as (
       select distinct pj.item_id from internal.post_judgement pj
        where pj.judged_at >= $1 and pj.prompt_id not like 'post-kind%' and pj.coinable
          and ($3::text[] is null or pj.item_id = any($3::text[]))
     ), late as materialized (
       select i.item_id, i.source, i.source_item_id, i.posted_at, i.first_seen_at
         from yes y
         join public.item i on i.item_id = y.item_id
        where i.origin = 'observed'
          and i.first_seen_at >= $1 and i.posted_at >= $1
          and i.first_seen_at - i.posted_at > make_interval(secs => $2::float8 / 1000)
     ), tied as materialized (
       select l.item_id, a.asset_key, a.address, coalesce(a.minted_at, a.first_seen_at) as launched_at
         from late l
         join internal.coin_post_link k on k.source = l.source and k.source_item_id = l.source_item_id
         join public.asset a on a.asset_key = k.asset_key
       union
       select l.item_id, a.asset_key, a.address, coalesce(a.minted_at, a.first_seen_at)
         from internal.coin_origin o
         join late l on l.item_id = o.post_item_id
         join public.asset a on a.asset_key = o.asset_key
        where o.status = any($5::text[])
     ), coin as materialized (
       select t.item_id, t.address,
              least((select min(r.taken_at) from public.market_reading r
                      where r.asset_key = t.asset_key and r.taken_at >= t.launched_at and r.market_cap_usd >= $4),
                    (select min(m.minute) from internal.coin_trade_minute m
                      where m.address = t.address and m.minute >= date_trunc('minute', t.launched_at) and m.last_mcap_usd >= $4)) as at
         from tied t
       union all
       select p.item_id, p.address, p.decided_at from internal.post_coin_pick p join late l on l.item_id = p.item_id where p.outcome = 'picked'
       union all
       select m.item_id, n.address, n.decided_at
         from internal.narrative_member m join late l on l.item_id = m.item_id
         join internal.narrative_coin_pick n on n.narrative_id = m.narrative_id
        where n.outcome = 'picked'
       union all
       select c.item_id, c.coin_address, c.first_seen_at from internal.coin_first_post c join late l on l.item_id = c.item_id
        where c.role is distinct from 'pointer'
     ), first_coin as (
       select distinct on (c.item_id) c.item_id, c.at, c.address from coin c where c.at is not null order by c.item_id, c.at
     )
     select l.item_id, l.posted_at, l.first_seen_at, f.at as coin_at, f.address as coin_address
       from late l left join first_coin f on f.item_id = l.item_id`;

/**
 * The posts found late since `postedSinceMs` (or only `only`), judged yes at least once, each with
 * the first time a coin for it was running. Empty when the route is off. Read-only.
 */
export async function loadLate(db: Db, postedSinceMs: number, policy: Policy = DEFAULT_POLICY, only: readonly string[] | null = null): Promise<readonly LateRecord[]> {
  const rows = await db.query<{ item_id: string; posted_at: Date | string; first_seen_at: Date | string; coin_at: Date | string | null; coin_address: string | null }>(
    LATE_SQL,
    [new Date(postedSinceMs).toISOString(), policy.rising.fypMaxAgeMs, only === null ? null : [...only], policy.oneCoin.minCapUsd, [...COIN_ORIGIN_TIES]],
  );
  const ms = (v: Date | string): number => (v instanceof Date ? v.getTime() : Date.parse(v));
  return rows.map((r) => ({
    itemId: r.item_id,
    postedAtMs: ms(r.posted_at),
    foundAtMs: ms(r.first_seen_at),
    coinAtMs: r.coin_at === null ? null : ms(r.coin_at),
    coinAddress: r.coin_address,
  }));
}

/** The route's posts at `nowMs` (or only those of `only`), by id. Nothing when it is off. */
export async function loadLateNoCoin(db: Db, nowMs: number, policy: Policy = DEFAULT_POLICY, only: readonly string[] | null = null): Promise<ReadonlyMap<string, LateRecord>> {
  if (!lateOn(policy)) return new Map();
  const rows = await loadLate(db, (nowMs - policy.lateNoCoin.maxPostAgeMs) as Millis, policy, only);
  return new Map(rows.filter((r) => lateHolds(r, nowMs, policy)).map((r) => [r.itemId, r] as const));
}

/** The facts about one post the route reads in a frame (rising.ts). */
export interface LatePost {
  readonly itemId: string;
  /** The judge's own yes (never the safety net), with the kind and the owner's Not a meme applied. */
  readonly judgedYes: boolean;
  /** Clears For You's views bar and the order model's score bar (rising.ts `byViews`). */
  readonly byViews: boolean;
  /** The one-coin rule's pick for the post on its card (live mode), if any. */
  readonly picked: boolean;
  /** The owner named a coin as the post's own. */
  readonly ownerCoin: boolean;
}

/** Whether the late route lets this post onto For You now. */
export function lateLets(p: LatePost, late: ReadonlyMap<string, LateRecord>): boolean {
  return late.has(p.itemId) && p.judgedYes && p.byViews && !p.picked && !p.ownerCoin;
}

/**
 * The late route's posts a For You list puts past its cut: For You is newest posted first, so a late
 * post usually sorts under the frame's last card. These join For You's list for good all the same
 * (feed-members.ts) — on the scroll at their own place — instead of never being on For You at all.
 * Members already on the list are left out: they are there.
 */
export function beyondCap<P extends { readonly id: string }>(ordered: readonly P[], maxRows: number, late: ReadonlySet<string>, members: ReadonlySet<string>): P[] {
  return ordered.slice(maxRows).filter((p) => late.has(p.id) && !members.has(p.id));
}
