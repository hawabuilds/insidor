/**
 * EVERY STATEMENT OF SQL IN THIS SERVICE, IN ONE FILE.
 *
 * The house rule is that store/ is the only package where SQL lives, and this bends it
 * the same way services/project/src/db.ts bends it, knowingly and in one file: 0010's
 * table has no repository behind it yet, and growing store/ two methods while another
 * change is in flight against it costs more than it buys. The intended destination is
 * named: this becomes store/src/repo/market.ts, unchanged in shape, and the move is a
 * file move rather than a rewrite. Nothing outside this file builds a query, and
 * reading.ts — where every decision is made — has no idea a database exists.
 *
 * IT RUNS AS THE SERVICE ROLE. That is the whole architecture in one line: this process
 * writes readings and cannot append to the decision log, because the connection it
 * holds has no INSERT on the schema that holds one.
 */

import { OBSERVED_ASSET_ORIGINS } from '@insidor/contracts/asset.ts';
import type { Db } from '@insidor/store';

import { numberOf, reasonOf } from './reading.ts';
import type { LastAnswer, MarketReading } from './reading.ts';

export interface AssetRow {
  chain: string;
  address: string;
}

/**
 * The coins to read this pass, most recently seen first.
 *
 * ★ IT IS BOUNDED, AND THE BOUND IS NOT AN OPTIMISATION. The endpoint behind this is
 * free and rate-limited, which is a budget of a different kind and exactly as spendable
 * as money: the vendor throttles after about eleven sequential calls and a pass that
 * walked the whole asset table would find that number before it found a price. So the
 * caller passes Policy.market.maxAssetsPerPass and the query obeys it.
 *
 * ORDERED BY `first_seen_at desc`, WHICH IS A CHOICE AND NOT A DEFAULT. What a bounded
 * pass leaves out is decided here, so it may as well be decided honestly: a coin nobody
 * has seen for a day is not the coin anybody is about to buy, and the product's whole
 * claim is about the first hour. `minted_at` would be the tempting key and is worse —
 * it is nullable, and 0005 exists because a coin whose mint time was never learned is
 * ordinary rather than broken. Sorting on it would push every such coin to one end of
 * the list and silently make "we never learned when this was minted" mean "we will
 * never read its price either". The tiebreak is the key, so two runs with nothing
 * changed read the same coins rather than reshuffling under the cap.
 *
 * ★ AND `origin = any(...)` IS HERE BECAUSE THIS IS THE ONE PLACE A FICTION LEAVES THE
 * DATABASE AND TOUCHES THE OUTSIDE WORLD. Every other allowlist in this repository stops
 * an invented row reaching a screen. This one stops it reaching a VENDOR: whatever this
 * statement returns is chunked into `read.states` and sent to dexscreener as a list of
 * addresses to price. A row the database records as written by a seed is not a coin, and
 * asking a real venue what it is worth is a category error before it is anything else.
 *
 * ★ IT IS THE SAME MECHANISM AS THE LAUNCHES RAIL, AND THAT IS WHY THE ORDER MATTERS.
 * The seed stamps `first_seen_at` at load time, so its fixtures are always the NEWEST rows
 * in the table — and this statement's ordering is `first_seen_at desc`. Measured on this
 * store: the thirteen fixtures occupy ranks 1 through 56 of 248, so they are not merely
 * inside the cap, they are the FIRST thing it buys. `MAX_ADDRESSES_PER_CALL` chunks in
 * order, which makes them the first call of the pass. The endpoint behind this is
 * rate-limited at about eleven sequential calls, so on any store where the asset count
 * exceeds `maxAssetsPerPass` the fictions are spent first and real coins are the ones
 * dropped at the bound. The bug is latent at 248 rows and structural at 301.
 *
 * ★ AND ONE OF THEM CAME BACK PRICED, WHICH IS THE PART THAT IS NOT MERELY WASTE.
 * `solana:Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump` is in the seed's fixture list AND
 * is a real mainnet address, so the vendor answered it: this store holds a
 * `public.market_reading` row carrying a genuine $12.1M market cap and $1.27M of
 * liquidity, taken live, filed against an asset whose `origin` says it was invented. That
 * row is real data wearing a fiction's provenance, and it is exactly the pairing every
 * origin filter in this repository exists to make unsayable — arriving from the direction
 * nobody was watching, because the fiction went OUT rather than a fiction coming in.
 *
 * ★ THERE IS NO STORY HERE, SO THE CONSTANT IS THE WHOLE ANSWER — and that is the line
 * between this filter and the one `mintedBetween` had to give up. This statement's subject
 * is a coin alone: "is this row a claim about the world" has one answer and it is
 * `OBSERVED_ASSET_ORIGINS`. A read whose subject is a STORY has two subjects and must
 * derive its list from the story instead; carrying a constant into one of those is the
 * bug 0016 was written to close. If the read has a story, the story decides; if it has
 * none, this list does.
 *
 * A fixture keeps whatever absence it already had, which is the correct and honest
 * outcome: nothing has read this coin, because it is not a coin. The allowlist rather than
 * `<> 'fixture'` for the reason it is an allowlist everywhere else — a denylist admits
 * every origin invented after it was written, `unrecorded` included, and "we cannot vouch
 * for this row" is not a licence to spend money asking a vendor about it.
 */
export async function assetsToRead(
  db: Db,
  chain: string,
  limit: number,
  hour: PictureHour | null = null,
  weighing: OlderCandidates | null = null,
  saved: SavedCoins | null = null,
  picked: PickedCoins | null = null,
  firstHour: FirstHourCoins | null = null,
  /** The tape's coins to read every pass (tapeCoins): at most this many; null reads none. */
  tapeLimit: number | null = null,
  /** The older coins a post's own coins name (olderNamedCoins); null reads none. */
  olderNamed: OlderNamedCoins | null = null,
): Promise<readonly AssetRow[]> {
  const pictured = hour === null ? [] : await picturedAtTheHour(db, chain, hour);
  const older = weighing === null ? [] : await olderCandidates(db, chain, weighing);
  const savedCoins = saved === null ? [] : await savedPostCoins(db, chain, saved);
  const held = picked === null ? [] : await pickedCoins(db, chain, picked);
  const waiting = picked === null ? [] : await waitingCoins(db, chain, picked);
  const young = firstHour === null ? [] : await firstHourCoins(db, chain, firstHour);
  const war = await warCoin(db, chain);
  const tape = tapeLimit === null ? [] : await tapeCoins(db, chain, tapeLimit);
  const named = olderNamed === null ? [] : await olderNamedCoins(db, chain, olderNamed);
  const rest = await onScreenThenNewest(db, chain, limit);
  /* The tied candidates in their first hour, then the coins tied to saved posts, then the picked and
     stated coins, then the older coins a pick is weighing, then the hour's coins, go first among the
     newest, never ahead of the coins on screen: those are what a card shows. Each list has its own
     limit, and the pass its bound — so on a full pass what gives way is the newest end. */
  const seen = new Set<string>();
  const out: AssetRow[] = [];
  for (const row of [...war.filter((r) => r.tier === 0), ...rest.filter((r) => r.tier === 0), ...young, ...tape, ...savedCoins, ...waiting, ...held, ...older, ...named, ...pictured, ...rest.filter((r) => r.tier !== 0)]) {
    if (seen.has(row.address) || out.length >= limit) continue;
    seen.add(row.address);
    out.push({ chain: row.chain, address: row.address });
  }
  return out;
}

/**
 * ★ THE "TWITTER WORLD WAR" COIN IS READ EVERY PASS, FIRST (the owner, 2026-10-24: one coin for the
 * whole war, on its card with its cap and Buy). It is the owner's choice (public.war_coin, 0134), on
 * no projected payload, so the on-screen tier never names it: chosen at an hour old, it had one
 * reading. One coin, first in the pass, under the same origin allowlist. A failed read (a database
 * before 0134) is an empty list: the pass reads its usual coins.
 */
async function warCoin(db: Db, chain: string): Promise<readonly (AssetRow & { tier: number })[]> {
  try {
    return await db.query<AssetRow & { tier: number }>(
      `select a.chain, a.address, 0 as tier
         from public.war_coin w join public.asset a on a.chain = $1 and a.address = w.address
        where a.origin = any($2::text[])`,
      [chain, [...OBSERVED_ASSET_ORIGINS]],
    );
  } catch {
    return [];
  }
}

/**
 * ★ THE TAPE'S COINS ARE READ EVERY PASS (the owner, 2026-10-26: "improve the tape"). The running
 * coins strip shows coins of viral posts trending over the day (services/read running-coins.ts,
 * public.tape_coin 0141), any post age, and leaves out a coin whose newest reading is older than
 * `runningCoins.freshMs`. A picked coin off For You was read only every few passes, so the day's
 * biggest runners fell off the strip for being unread. These are the coins a pick held or the owner
 * called right that traded most in any hour of the last day, at most `limit` (the caller's). A failed read is
 * an empty list: the pass reads its usual coins.
 */
async function tapeCoins(db: Db, chain: string, limit: number): Promise<readonly (AssetRow & { tier: number })[]> {
  try {
    return await db.query<AssetRow & { tier: number }>(
      `with origin as (
         select address from internal.post_coin_pick where outcome = 'picked' and address is not null
         union select address from internal.narrative_coin_pick where outcome = 'picked' and address is not null
         union select coin_address from internal.owner_feedback where subject_kind = 'coin_match' and verdict in ('right', 'wrong') and coin_address is not null
       )
       select a.chain, a.address, 2 as tier
         from public.asset a join origin o on o.address = a.address
         join lateral (select max(m.volume_1h_usd) as v from public.market_reading m
                        where m.asset_key = a.asset_key and m.taken_at >= now() - interval '24 hours') d on d.v is not null
        where a.chain = $1 and a.origin = any($2::text[])
        order by d.v desc, a.asset_key
        limit $3`,
      [chain, [...OBSERVED_ASSET_ORIGINS], limit],
    );
  } catch {
    return [];
  }
}

/** The tied candidates launched in the last `withinMs` of `nowMs` (Policy.market.firstHour): at most `limit` a pass. */
export interface FirstHourCoins {
  readonly nowMs: number;
  readonly withinMs: number;
  readonly limit: number;
}

/**
 * ★ A TIED CANDIDATE IS READ EVERY PASS IN ITS FIRST HOUR (the owner, 2026-10-24: "make sure I
 * would've caught the right baldcat coin early before it took off"). The newest-first bound reads a
 * launch once, at a minute or two old, if a pass falls then: on 21-24 Oct a candidate got a median 0
 * readings in its first 10 minutes, and of 94 coins that ran only 7 were ever read under $20K in their
 * first half hour. $baldcat was read at +3.7 and +8.8 minutes and then not until +72, at $52.8K —
 * so the early pick (services/runner work/early-pick.ts) had two looks, and the ordinary rule none
 * until it was over.
 *
 * Every candidate (0113) launched in the last `withinMs` that a post ties by a link, its stated name
 * or its picture — a narrative's coins are its posts' candidates, so they are here too. In order:
 * the coins of a post on For You, or of a narrative with a post on For You, or of a coin-first post
 * (those are the ones a push can be about); then a link or stated name before a picture alone; then
 * the newest launch. At most `limit`. A failed read is an empty list: the pass reads its usual coins.
 *
 * What breaks if changed carelessly: dropping the For You order. There are a median 138 coins with a
 * link or stated name in any hour (most are launchers linking their own promotion), so without it the
 * bound fills with them and the coins of the posts we actually show are the ones left out.
 */
async function firstHourCoins(db: Db, chain: string, w: FirstHourCoins): Promise<readonly (AssetRow & { tier: number })[]> {
  try {
    return await db.query<AssetRow & { tier: number }>(
      `with c as (
         select o.address, max(o.launched_at) as launched,
                bool_or(o.evidence->'ties' ?| array['link','name_stated']) as made,
                bool_or(exists (select 1 from public.feed_post f where f.feed_id = 'fyp' and f.item_id = o.item_id)
                     or exists (select 1 from internal.narrative_member m join internal.narrative_member n on n.narrative_id = m.narrative_id
                                  join public.feed_post f on f.feed_id = 'fyp' and f.item_id = n.item_id
                                 where m.item_id = o.item_id)
                     or exists (select 1 from internal.coin_first_post p where p.item_id = o.item_id and p.admitted_at is not null)) as shown
           from internal.one_coin_candidate o
          where o.found_at >= $2::timestamptz - make_interval(secs => $3::double precision / 1000)
            and o.launched_at >= $2::timestamptz - make_interval(secs => $3::double precision / 1000)
            and o.launched_at <= $2::timestamptz
            and o.evidence->'ties' ?| array['link','name_stated','picture']
          group by o.address
       )
       select a.chain, a.address, 6 as tier
         from c join public.asset a on a.chain = $1 and a.address = c.address
        where a.origin = any($5::text[])
        order by c.shown desc, c.made desc, c.launched desc, a.asset_key asc
        limit $4`,
      [chain, new Date(w.nowMs).toISOString(), w.withinMs, w.limit, [...OBSERVED_ASSET_ORIGINS]],
    );
  } catch {
    return [];
  }
}

/** The tied candidates in their first hour alone: the light pass's whole list (main.ts `light`). */
export async function firstHourOnly(db: Db, chain: string, w: FirstHourCoins): Promise<readonly AssetRow[]> {
  return (await firstHourCoins(db, chain, w)).map((r) => ({ chain: r.chain, address: r.address }));
}

/** The coins tied to saved posts, launched in the last `withinMs` of `nowMs`: at most `limit` a pass. */
export interface SavedCoins {
  readonly nowMs: number;
  readonly withinMs: number;
  readonly limit: number;
}

/**
 * ★ A COIN TIED TO A SAVED POST IS READ EVERY PASS WHILE IT IS JUST LAUNCHED (the owner, 2026-10-24:
 * a saved post's push goes when its first tied coin starts running, services/notify saved-post.ts).
 * "Running" is the coin's last hour in a fresh reading, and the newest-first bound reads a new coin
 * only in its first minutes: on 23 Oct $KURIBO, tied to the owner's saved post, was read at 22:51 and
 * then not again until 23:53. 0129's internal.saved_post_coins names the addresses (never who saved
 * them); the origin allowlist holds here as on every other list. A failed read — a database before
 * 0129 — is an empty list: the pass reads its usual coins.
 */
async function savedPostCoins(db: Db, chain: string, w: SavedCoins): Promise<readonly (AssetRow & { tier: number })[]> {
  try {
    return await db.query<AssetRow & { tier: number }>(
      `select a.chain, a.address, 4 as tier
         from internal.saved_post_coins($2::timestamptz, $3::double precision, $4::integer) s
         join public.asset a on a.chain = $1 and a.address = s.address
        where a.origin = any($5::text[])`,
      [chain, new Date(w.nowMs).toISOString(), w.withinMs, w.limit, [...OBSERVED_ASSET_ORIGINS]],
    );
  } catch {
    return [];
  }
}

/** The older coins the one-coin pick is weighing (Policy.oneCoin.existing): found since `nowMs - withinMs`, at most `limit`. */
export interface OlderCandidates {
  readonly nowMs: number;
  readonly withinMs: number;
  readonly limit: number;
}

/**
 * ★ AN OLDER COIN A PICK IS WEIGHING IS READ WHILE IT IS WEIGHED. The one-coin pick (services/runner
 * work/one-coin.ts) adds, for each new post, the older coins its names tie, and judges them on market
 * readings when the trade feed cannot measure them (a coin off its curve). But the newest-first bound
 * reads a coin only in its first minutes, and an older coin is not on a card until it is picked: on
 * 19 Oct "Rip Kim Jong-Un" had no reading for 22 hours, so the rule could never see it trade. This
 * reads the second path's candidates found in the last `withinMs` (the pick's watch), newest found
 * first, at most `limit` a pass. A failed read here is an empty list: the pass reads its usual coins.
 */
async function olderCandidates(db: Db, chain: string, w: OlderCandidates): Promise<readonly (AssetRow & { tier: number })[]> {
  try {
    return await db.query<AssetRow & { tier: number }>(
      `select a.chain, a.address, 3 as tier
         from (select address, max(found_at) as found from internal.one_coin_candidate
                where path = 'existing' and found_at >= $2::timestamptz - make_interval(secs => $3::double precision / 1000)
                group by address) c
         join public.asset a on a.chain = $1 and a.address = c.address
        where a.origin = any($5::text[])
        order by c.found desc, a.asset_key asc
        limit $4`,
      [chain, new Date(w.nowMs).toISOString(), w.withinMs, w.limit, [...OBSERVED_ASSET_ORIGINS]],
    );
  } catch {
    return [];
  }
}

/** The older coins a post's own coins name (Policy.oneCoin.olderTrading): for posts picked since `nowMs - withinMs`. */
export interface OlderNamedCoins {
  readonly nowMs: number;
  readonly withinMs: number;
  readonly limit: number;
  readonly minCarriers: number;
  readonly minCapUsd: number;
  readonly recheckMs: number;
  readonly launchLeadMs: number;
}

/**
 * ★ AN OLDER COIN THE POST'S OWN COINS NAME IS READ, SO THE CARD CAN LIST IT WHILE IT TRADES (core
 * match/older-trading.ts; the owner, 2026-10-27, "*paws at you*": two 23 Oct Himmel coins were the
 * ones trading, and one had never been read). An older coin that only shares a name is on no card and
 * no pick, so no other list reads it. This reads, for each post picked in the last `withinMs`, its
 * older coins (internal.older_coin, and its own list) launched `launchLeadMs` or more before it whose
 * ticker or name `minCarriers` of its link- or picture-tied coins carry: one never read first, then
 * one whose last reading was at `minCapUsd` or more, and a dead one again only after `recheckMs`.
 * Two days of picks held 344 such coins; most are dead, so after the first hour this reads a few.
 *
 * The name test here is a looser spelling than core's (letters and digits, lower case): it may read a
 * coin the projector then leaves out, never miss one it would list. A failed read is an empty list.
 *
 * What breaks if changed carelessly: the posts' join. Joined to public.asset before the candidates
 * are cut to posts carrying a name, the planner walks the whole asset table: 15 s a pass, not 0.4.
 */
async function olderNamedCoins(db: Db, chain: string, w: OlderNamedCoins): Promise<readonly (AssetRow & { tier: number })[]> {
  try {
    return await db.query<AssetRow & { tier: number }>(
      `with posts as materialized (
         select p.item_id, i.posted_at, p.evidence -> 'standings' as st
           from internal.post_coin_pick p join public.item i on i.item_id = p.item_id
          where p.decided_at >= $2::timestamptz - make_interval(secs => $3::double precision / 1000) and i.posted_at is not null
       ), carried as materialized (
         select po.item_id, lower(regexp_replace(a.symbol, '[^[:alnum:]]', '', 'g')) as nm
           from posts po cross join lateral jsonb_array_elements(case when jsonb_typeof(po.st) = 'array' then po.st else '[]'::jsonb end) s
           join public.asset a on a.chain = $1 and a.address = s ->> 'address'
          where (s -> 'ties') ?| array['link', 'picture'] and a.symbol is not null
          group by 1, 2 having count(distinct a.address) >= $6
       ), named as materialized (
         select distinct item_id from carried
       ), cand as materialized (
         select o.item_id, o.address from internal.older_coin o join named n on n.item_id = o.item_id
         union
         select s.subject_id, s.address from public.same_name_coin s join named n on n.item_id = s.subject_id where s.subject_kind = 'post'
       ), coins as (
         select distinct a.asset_key, a.chain, a.address
           from cand c join posts po on po.item_id = c.item_id
           cross join lateral (select x.* from public.asset x where x.chain = $1 and x.address = c.address) a
          where a.origin = any($5::text[])
            and a.minted_at < po.posted_at - make_interval(secs => $9::double precision / 1000)
            and exists (select 1 from carried k where k.item_id = c.item_id
                         and k.nm in (lower(regexp_replace(coalesce(a.symbol, ''), '[^[:alnum:]]', '', 'g')), lower(regexp_replace(coalesce(a.name, ''), '[^[:alnum:]]', '', 'g'))))
       )
       select c.chain, c.address, 3 as tier
         from coins c
         left join lateral (select m.taken_at, m.market_cap_usd from public.market_reading m where m.asset_key = c.asset_key order by m.taken_at desc limit 1) r on true
        where r.taken_at is null or r.market_cap_usd >= $7
           or r.taken_at < $2::timestamptz - make_interval(secs => $8::double precision / 1000)
        order by r.taken_at asc nulls first, c.asset_key asc
        limit $4`,
      [chain, new Date(w.nowMs).toISOString(), w.withinMs, w.limit, [...OBSERVED_ASSET_ORIGINS], w.minCarriers, w.minCapUsd, w.recheckMs, w.launchLeadMs],
    );
  } catch {
    return [];
  }
}

/** The picked and stated coins to read every pass (Policy.runnerLink.running): touched since `nowMs - withinMs`, at most `limit`. */
export interface PickedCoins {
  readonly nowMs: number;
  readonly withinMs: number;
  readonly limit: number;
}

/** The trade peak, in the quote token, a waiting post's candidate needs to be read (the runner's `WAITING_SWEEP_MIN_PEAK_QUOTE`). */
const WAITING_MIN_PEAK_QUOTE = 100;

/**
 * ★ A COIN PICKED FOR A POST IS READ EVERY PASS, AND SO IS A COIN CARRYING A POST'S STATED NAME. The
 * newest-first bound reads a launch only in its first minutes, and only if a pass falls in them: on
 * 23 Oct 3,026 of the 11,242 coins first seen 18:00-22:00 UTC were never read at all, "You Missed Coin"
 * ($BITCHES) among them — the coin a post had stated, which ran to millions while the pick stayed on
 * a copycat because the rule never saw it trade. This reads, newest first, every coin a post's or a
 * narrative's pick holds (picked, updated since `withinMs`), every candidate tied by the stated
 * name (0113 evidence `name_stated`) found since then — the longest unread first, so about 240 such
 * coins over two days are each read every few passes — at most `limit` a pass. The running pick on For
 * You and the missed-runner net read the same readings. A failed read here is an empty list.
 */
async function pickedCoins(db: Db, chain: string, w: PickedCoins): Promise<readonly (AssetRow & { tier: number })[]> {
  try {
    return await db.query<AssetRow & { tier: number }>(
      `select a.chain, a.address, 5 as tier
         from (select address, max(at) as at from (
                 select address, updated_at as at from internal.post_coin_pick where outcome = 'picked' and updated_at >= $2::timestamptz - make_interval(secs => $3::double precision / 1000)
                 union all
                 select address, updated_at from internal.narrative_coin_pick where outcome = 'picked' and updated_at >= $2::timestamptz - make_interval(secs => $3::double precision / 1000)
                 union all
                 select address, found_at from internal.one_coin_candidate where found_at >= $2::timestamptz - make_interval(secs => $3::double precision / 1000) and evidence->'ties' ? 'name_stated'
               ) u group by address) c
         join public.asset a on a.chain = $1 and a.address = c.address
         left join lateral (select m.taken_at from public.market_reading m where m.asset_key = a.asset_key order by m.taken_at desc limit 1) r on true
        where a.origin = any($5::text[])
        order by r.taken_at asc nulls first, c.at desc, a.asset_key asc
        limit $4`,
      [chain, new Date(w.nowMs).toISOString(), w.withinMs, w.limit, [...OBSERVED_ASSET_ORIGINS]],
    );
  } catch {
    return [];
  }
}

/** How many of a waiting post's coins are read a pass, from how many of the biggest by their trade peak. */
const WAITING_READS_PER_PASS = 40;
const WAITING_TOP = 1_000;

/**
 * ★ A POST STILL WAITING FOR A COIN: ITS BIGGEST COINS, KEPT FRESH ("paws at you", 2026-10-27: Fp4Jkq…
 * bonded two hours after the pick was left waiting, unread). The runner's waiting sweep judges these
 * posts only on recent readings, so they cannot share the picked coins' list, where
 * about 800 coins took more than an hour to come round. The candidates of posts left waiting since
 * `withinMs` whose trades peaked at `WAITING_MIN_PEAK_QUOTE` or more (about 450 on 27 Oct, at most
 * `WAITING_TOP`) are read in turn, the longest unread first, at most `WAITING_READS_PER_PASS` a pass:
 * each about once an hour, inside the sweep's own freshness bar. A failed read here is an empty list.
 */
async function waitingCoins(db: Db, chain: string, w: PickedCoins): Promise<readonly (AssetRow & { tier: number })[]> {
  try {
    return await db.query<AssetRow & { tier: number }>(
      `select a.chain, a.address, 5 as tier
         from (select oc.address, max(s.peak_mcap_sol) as peak
                 from internal.post_coin_pick p
                 join internal.one_coin_candidate oc on oc.item_id = p.item_id
                 join internal.coin_trade_state s on s.address = oc.address
                where p.outcome = 'waiting' and p.decided_at >= $2::timestamptz - make_interval(secs => $3::double precision / 1000)
                  and s.peak_mcap_sol >= $5
                group by oc.address
                order by peak desc
                limit $6) c
         join public.asset a on a.chain = $1 and a.address = c.address
         left join lateral (select m.taken_at from public.market_reading m where m.asset_key = a.asset_key order by m.taken_at desc limit 1) r on true
        where a.origin = any($7::text[])
        order by r.taken_at asc nulls first, a.asset_key asc
        limit $4`,
      [chain, new Date(w.nowMs).toISOString(), w.withinMs, WAITING_READS_PER_PASS, WAITING_MIN_PEAK_QUOTE, WAITING_TOP, [...OBSERVED_ASSET_ORIGINS]],
    );
  } catch {
    return [];
  }
}

/** Which pictured coins to read once after their first hour (Policy.coinVectors.untraded). */
export interface PictureHour {
  readonly nowMs: number;
  readonly afterLaunchMs: number;
  readonly withinMs: number;
  readonly limit: number;
}

/**
 * ★ A PICTURED COIN IS READ ONCE AFTER ITS FIRST HOUR. The owner's rule for coin picture vectors
 * (tools/archive-coin-vectors.ts) needs to know whether each coin traded in its first hour, and the
 * newest-first bound above reads a coin only in its first few minutes: on 16 Oct, 7,307 of 11,430
 * pictured coins had no reading after their hour, so their vectors could not be decided and stayed.
 * This adds the coins with a picture vector that passed their hour in the last `withinMs` and have
 * no reading since, oldest hour first, at most `limit` a pass (about 40 at the busiest). A failed
 * read here is an empty list: the pass reads its usual coins.
 */
async function picturedAtTheHour(db: Db, chain: string, hour: PictureHour): Promise<readonly (AssetRow & { tier: number })[]> {
  try {
    return await db.query<AssetRow & { tier: number }>(
      `select a.chain, a.address, 2 as tier
         from public.asset a
        where a.chain = $1
          and a.origin = any($6::text[])
          and a.minted_at <= $2::timestamptz - make_interval(secs => $3::double precision / 1000)
          and a.minted_at >= $2::timestamptz - make_interval(secs => ($3::double precision + $4::double precision) / 1000)
          and exists (select 1 from internal.image_embedding e where e.subject_kind = 'asset' and e.subject_id = a.asset_key)
          and not exists (select 1 from public.market_reading m
                           where m.chain = a.chain and m.address = a.address
                             and m.taken_at >= a.minted_at + make_interval(secs => $3::double precision / 1000))
        order by a.minted_at asc, a.asset_key asc
        limit $5`,
      [chain, new Date(hour.nowMs).toISOString(), hour.afterLaunchMs, hour.withinMs, hour.limit, [...OBSERVED_ASSET_ORIGINS]],
    );
  } catch {
    return [];
  }
}

async function onScreenThenNewest(db: Db, chain: string, limit: number): Promise<readonly (AssetRow & { tier: number })[]> {
  /* ★ THE COINS ON SCREEN COME FIRST. The newest-first bound reads about five minutes of
     mints, and a coin on a For You or Popular card is usually older than that — measured on
     2026-10-13, the six coins on the cards ranked 7,864th to 10,603rd newest, so they were
     read once when they were new and then never again, and every card showed a stale
     absence and no Buy. So every coin a projected feed or board names (`coinId`, at any
     depth of its payload) is read first, then the newest fill the rest of the bound. The
     origin allowlist holds on both halves.

     ★ AND EVERY LIVE NARRATIVE'S PAGE (October 2026). The Narratives card's coin line shows its
     coin's market cap, and a narrative's coin (`coins`, `topCoin`) is on its page, not on the
     board's row, so it was read only while new: on 18 Oct every top coin on the tab said
     "not read yet" and each phone read every card's market from the token chart instead, every
     four seconds. A live narrative is one not marked dead, observed; about 25 coins. They join the
     coins on screen in the same bounded pass and cost no call of their own. */
  return db.query<AssetRow & { tier: number }>(
    `with on_screen as (
       select distinct c #>> '{}' as asset_key
         from (select payload from public.rising_row
               union all
               select payload from public.board_row
               union all
               select payload from public.story_view
                where dead is not true and payload #>> '{provenance,kind}' = 'observed') p,
              jsonb_path_query(p.payload, 'strict $.**.coinId') c
     ),
     screen as (
       select a.chain, a.address, a.asset_key, a.first_seen_at, 0 as tier
         from public.asset a
         join on_screen s on s.asset_key = a.asset_key
        where a.chain = $1
          and a.origin = any($3::text[])
     ),
     newest as (
       select chain, address, asset_key, first_seen_at, 1 as tier
         from public.asset
        where chain = $1
          and origin = any($3::text[])
        order by first_seen_at desc, asset_key asc
        limit $2
     )
     select chain, address, tier
       from (select * from screen
             union all
             select * from newest where asset_key not in (select asset_key from screen)) picked
      order by tier, first_seen_at desc, asset_key asc
      limit $2`,
    /* A bound parameter and never an interpolated list, the rule this whole file holds
       to. The list arrives from contracts, where 0013's CHECK is held to it by a test,
       rather than being typed into the string above as a fifth copy of one closed list. */
    [chain, limit, [...OBSERVED_ASSET_ORIGINS]],
  );
}

/**
 * Each coin's latest aggregator answer (a `solana:pool` row: a route or "no route"), so the pass can
 * reuse it instead of asking again (reading.ts `reusableRoute`) or keep it when it cannot ask
 * (`keptRoute`). Only `pool` rows: a "nobody asked" or kept row after it must not hide it, and a kept
 * row must never pass for an answer. The same latest-per-asset seek the
 * projector makes, on `market_reading_latest_cover_idx` (0165).
 */
export async function lastAnswers(db: Db, assetKeys: readonly string[]): Promise<ReadonlyMap<string, LastAnswer>> {
  const out = new Map<string, LastAnswer>();
  if (assetKeys.length === 0) return out;
  const rows = await db.query<{ asset_key: string; taken_at: Date | string; tradable: boolean; quoted_by: string | null }>(
    `select distinct on (asset_key) asset_key, taken_at, tradable, quoted_by
       from public.market_reading
      where asset_key = any($1::text[]) and quoted_by = 'solana:pool'
      order by asset_key, taken_at desc`,
    [assetKeys],
  );
  for (const r of rows) {
    out.set(r.asset_key, { takenAt: new Date(r.taken_at).getTime(), tradable: r.tradable, quotedBy: r.quoted_by });
  }
  return out;
}

/**
 * Append the readings.
 *
 * `on conflict do nothing` and NOT `do update`, and the reason is structural rather
 * than stylistic: public.market_reading carries 0001's append-only trigger, so an
 * UPDATE raises rather than writes. A row already at this (asset, instant) is the same
 * reading arriving twice — a re-run of the same pass — and the honest response to that
 * is to keep the first one. A correction is a new row at a new instant, which is the
 * one sentence this whole table is arranged around.
 *
 * ★ THERE IS NO `coalesce(..., 0)` IN THIS STATEMENT AND THERE NEVER MAY BE. Every
 * number is passed as `number | null` with its reason beside it, and the four
 * `*_xor_reason` constraints reject the row if exactly one of the pair is not set. A
 * zero written here would be indistinguishable, forever, from a coin that is genuinely
 * worth nothing.
 */
export async function writeReadings(db: Db, readings: readonly MarketReading[]): Promise<number> {
  let written = 0;
  for (const r of readings) {
    const result = await db.query<{ written: number }>(
      `insert into public.market_reading (
         chain, address, asset_key, venue_id, taken_at,
         price_usd, price_absent,
         market_cap_usd, market_cap_absent, market_cap_basis,
         liquidity_usd, liquidity_absent,
         price_change_24h_pct, price_change_24h_absent,
         tradable, quoted_by,
         source_vendor, source_endpoint,
         volume_1h_usd, buys_1h, sells_1h, last_hour_absent
       ) values (
         $1, $2, $3, $4, $5,
         $6, $7,
         $8, $9, $10,
         $11, $12,
         $13, $14,
         $15, $16,
         $17, $18,
         $19, $20, $21, $22
       )
       on conflict (chain, address, taken_at) do nothing
       returning 1 as written`,
      [
        r.chain,
        r.address,
        r.assetKey,
        r.venueId,
        new Date(r.takenAt).toISOString(),
        numberOf(r.priceUsd),
        reasonOf(r.priceUsd),
        numberOf(r.marketCapUsd),
        reasonOf(r.marketCapUsd),
        r.marketCapBasis,
        numberOf(r.liquidityUsd),
        reasonOf(r.liquidityUsd),
        numberOf(r.priceChange24hPct),
        reasonOf(r.priceChange24hPct),
        r.tradable,
        r.quotedBy,
        r.sourceVendor,
        r.sourceEndpoint,
        r.lastHour.kind === 'read' ? r.lastHour.volumeUsd : null,
        r.lastHour.kind === 'read' ? r.lastHour.buys : null,
        r.lastHour.kind === 'read' ? r.lastHour.sells : null,
        r.lastHour.kind === 'absent' ? r.lastHour.why : null,
      ],
    );
    written += result.length;
  }
  return written;
}
