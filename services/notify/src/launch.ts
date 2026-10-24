/**
 * THE ONE PUSH: A COIN JUST LAUNCHED FOR A POST YOU MAY HAVE SEEN (the owner, 2026-10-20: "i want to
 * only receive notifications if theres a coin that just launched and is running from that post and
 * idc about the coins that come after"; "people going about their day, not glued to the app").
 *
 * Every pass (Policy.notify.pipelineLoopMs) this reads the For You cards that show a coin the
 * one-coin rule PICKED (the card's `evidence.picked`, which the projector writes only in
 * Policy.oneCoin.mode 'live') and the narrative pages that show a coin, and queues `coin_launched`
 * for every profile — no star, no save — when, and only when:
 *
 *   1. it is the post's FIRST pick. The post is remembered (people.pipeline_seen, stream `launch`,
 *      `p:<item>`) the first time any pick is seen on it, pushed or not, so a hand-over to a later
 *      coin, a copycat, or the same post picked again is never news. A narrative the same (`n:<id>`).
 *   2. the coin launched at or after the post was first on For You (public.feed_post's
 *      first_shown_at; a narrative's: its earliest post on For You). This is the "we caught it
 *      early" case. Replayed on 19-20 Oct's live picks: of 16 first picks for For You posts, 6
 *      launched after the post was on For You, 4 between the post and its first showing, 6 were older
 *      than the post — those ten are the coins the owner said he does not care about.
 *      ★ EXCEPT A COIN-FIRST POST (internal.coin_first_post, 0116: For You took it by the coin-first
 *      route alone, on the judge's yes and its picked coin). There the coin always came first — it is
 *      why the post is there — so rule 2 would never push it. It is pushed on its FIRST PICK: the first
 *      coin for the post that passed the running rule (rule 1 remembers the post, so no later coin is
 *      pushed). The owner's "first coin that launched and is running" is the first to RUN, not the
 *      first to link: in the Laura case (20 Oct) a dud copycat linked Saylor's repost four seconds
 *      before $Laura launched, and a "first to link" rule would have kept $Laura from being pushed.
 *      Rules 1, 3 and 4 hold as for any post.
 *   3. the coin is still "just launched": seen within Policy.notify.launch.maxLaunchAgeMs of its launch —
 *      or, picked later, within `lateRunningMs` while its last hour clears the saved-post running bars;
 *      a late pick that is quiet leaves its post unspent, so a coin that dies and runs again is pushed
 *      when it runs (once a coin, as ever).
 *      A coin whose launch time we do not know is not pushed (we cannot say it came after).
 *   4. the coin was never pushed before (`c:<address>`), so a post and its narrative picking the
 *      same coin, or two posts picking it, is one push. The deliverer's claim is keyed by the
 *      address too, so even a second producer could not push it twice to one person.
 *
 * ★ THE STRONGEST FIRST. One pass queues its coins highest market cap first; the deliverer pushes
 * at most Policy.notify.launch.perDay a day per person (core `pacingOf`), so when a busy pass meets a
 * nearly-full day, what gets through is the biggest. A coin past the cap is still listed.
 *
 * ★ WHAT THE PUSH SAYS is facts about the world: the ticker, the post's words and who posted them,
 * its market cap when we have one (text.ts). Nothing of the rule — no buyers, no "picked".
 *
 * ★ A POST THAT STARTED A NARRATIVE (the owner, 2026-10-23: "find the posts that START the narratives
 * first, then be notified when they are coined"): when the pushed post is its narrative's starting
 * post and we had it before the coin (starting-post.ts), the same push says "$DOGZILLA launched from
 * the post that started Dogzilla" instead. The wording only: the same one push, the same rules, the
 * same daily cap — never a second push.
 *
 * ★ EXCEPT A RUNNER HAND-OVER (the owner, 2026-10-24: "I want to be notified and catch the runner
 * early", option 2 — everyone). When the post's pick moved to a later coin by the runner hand-over
 * (services/runner work/runner-handover.ts: running now at three times the first coin's hour; the
 * pick's evidence `runner_handover`) and the card shows it, that coin is pushed past rule 1, ONCE PER
 * RUNNER (`h:<item>|<coin>`, and the deliverer's claim `<item>|#runner|<coin>`): "A new coin from @X's post is
 * running: $TICKER, $45K cap". Rules 3 and 4 and the coin gate hold, the daily cap is the launch
 * push's own, and rule 2 holds without the coin-first exception: the new coin always came after.
 * Every later runner of a post is pushed once (`h:<item>|<coin>`; the owner, 2026-10-24: "notify on
 * every new runner"); rule 4 keeps a coin to one push, so a pick handed back to a coin already pushed
 * says nothing again.
 *
 * ★ EXCEPT AN ORIGINAL BROUGHT BACK BY ITS PROMOTION'S COIN (the owner, 2026-10-24; Policy.rising
 * .promotion, services/project promotions.ts). A caller's post quoting an older viral post is never
 * shown; its coin goes to the original, and an original older than the coin-link age at the launch
 * (core `promotionMaxAgeMs`) comes back to For You only while the coin runs. Rules 1 and 2 would never
 * push it — its first For You was days ago, or the coin came before it came back — so such a post is
 * pushed past both, ONCE PER POST (`v:<item>`) and once per coin (rule 4), while the coin is at most
 * `lateRunningMs` old and its last hour clears the saved-post running bars now. A revival is read off
 * the frame For You shows now (public.rising_row): a picked coin on the card that is not the post's
 * own pick (internal.post_coin_pick, 0129) and launched more than that age after the post. Without
 * 0129's grant nothing is a revival. The coin gate holds; the wording is the launch push's own.
 *
 * ★ A LAUNCHPAD COIN ONLY (the owner, 2026-10-23: "coins that are launched from pumpfun"): a coin
 * whose stored row is not the launchpad's seen launch is not pushed (coin-gate.ts). Its keys are
 * remembered all the same, so the post's later coins never follow as a hand-over.
 *
 * ★ A TAP OPENS THE COIN'S CHART (`/#/token/solana:<mint>`), not the post (the owner, 2026-10-23:
 * "a notification that a coin launched should open that coin's token chart page"). It linked the
 * post until then, so every launch push opened For You with the post's sheet. The post is still the
 * row's card in the list: it rides in the facts as `item` (faces.ts postOfRow reads it there).
 *
 * The first look remembers every pick already shown and sends nothing, as every pipeline stream
 * does: turning this on must not push yesterday's coins. Cost: our own tables, plus the free
 * market quote coin-facts.ts already makes, only for a pass that has a coin to push.
 *
 * What breaks if changed carelessly: remembering the post only when it is pushed. Then a post
 * whose first coin launched before For You would push its hand-over coin later as if it were first.
 * And reading every post's first coin, not only a coin-first post's: then a post For You took on its
 * views would push an older coin it never caught early.
 */

import { DEFAULT_POLICY, type NotifyPolicy } from '@insidor/contracts/policy.ts';
import { promotionMaxAgeMs } from '@insidor/core';

import { coinFacts, type Quotes } from './coin-facts.ts';
import { coinGate, coinGateFacts, type CoinGateFacts } from './coin-gate.ts';
import type { Db } from './deliver.ts';
import { settledCoin } from './first-coin.ts';
import { tokenHref } from './pipeline.ts';
import { lineCoin } from './post-watch.ts';
import { startedTitle, startRows } from './starting-post.ts';
import { isRunning, lastHours } from './saved-post.ts';

export const LAUNCH_STREAM = 'launch';
const SEEDED = '#seeded';

/** A post on For You whose card shows a picked coin, or a narrative whose page shows a coin, as the pass reads it. */
export interface Picked {
  readonly key: string;
  readonly address: string;
  readonly ticker: string;
  /** When the post (or the narrative's first post) was first on For You. */
  readonly onForYouMs: number;
  /** The coin's launch; null when unknown. */
  readonly launchedMs: number | null;
  readonly capUsd: number | null;
  /** The post the push is about: the post itself, or the narrative's first post on For You. */
  readonly itemId: string;
  readonly excerpt: string | null;
  readonly author: string | null;
  readonly image: string | null;
  readonly logo: string | null;
  /**
   * For a post For You took by the coin-first route alone (0116): the earliest-launched coin tying it,
   * null when none is known. Absent for every other post and every narrative: rule 2 holds for them.
   */
  readonly coinFirst?: { readonly firstCoinAddress: string | null };
  /** The pick on the card is the runner hand-over's (services/runner work/runner-handover.ts): pushed as "a new coin … is running". */
  readonly runner?: boolean;
  /** Its coin's last hour clears the running bars now (only read for a coin past `maxLaunchAgeMs`, and for a revival). */
  readonly runningNow?: boolean;
  /** An old original brought back to For You by its promotion's running coin (the header): pushed past rules 1 and 2, once per post. */
  readonly revival?: true;
}

/** The timing rule's ages: three hours as launched, and up to `lateRunningMs` while running. */
type LaunchAges = Pick<NotifyPolicy['launch'], 'maxLaunchAgeMs'> & Partial<Pick<NotifyPolicy['launch'], 'lateRunningMs'>>;

/** Young enough: within `maxLaunchAgeMs`, or past it within `lateRunningMs` while it runs. */
function youngEnough(p: Pick<Picked, 'launchedMs' | 'runningNow'>, nowMs: number, rule: LaunchAges): boolean {
  if (p.launchedMs === null) return false;
  const age = nowMs - p.launchedMs;
  return age <= rule.maxLaunchAgeMs || (rule.lateRunningMs !== undefined && age <= rule.lateRunningMs && p.runningNow === true);
}

/** A first pick that may still run inside `lateRunningMs`: its post is not spent yet, and is looked at again next pass. */
export function waitsToRun(p: Pick<Picked, 'launchedMs' | 'runningNow'>, nowMs: number, rule: LaunchAges): boolean {
  if (p.launchedMs === null || rule.lateRunningMs === undefined || p.runningNow === true) return false;
  const age = nowMs - p.launchedMs;
  return age > rule.maxLaunchAgeMs && age <= rule.lateRunningMs;
}

/** A revived original's push, remembered once per post whatever coin brought it back. */
export const revivalKey = (itemId: string): string => `v:${itemId}`;

/** A revival's timing: the coin at most `lateRunningMs` old and running now. No rule 2: the coin came first. */
export function revivalEarlyEnough(p: Pick<Picked, 'launchedMs' | 'runningNow'>, nowMs: number, rule: LaunchAges): boolean {
  return p.launchedMs !== null && rule.lateRunningMs !== undefined && nowMs - p.launchedMs <= rule.lateRunningMs && p.runningNow === true;
}

/**
 * Whether a card's picked coin is a revival (the header): not the post's own pick, and launched more
 * than the coin-link age after the post. Unknown times are not one.
 */
export function isRevival(c: { readonly launchedMs: number | null; readonly postedMs: number | null; readonly ownPick: boolean }, maxAgeMs: number = promotionMaxAgeMs(DEFAULT_POLICY)): boolean {
  return !c.ownPick && c.launchedMs !== null && c.postedMs !== null && c.launchedMs - c.postedMs > maxAgeMs;
}

/** A hand-over push, remembered once per post AND coin (the owner, 2026-10-24: "notify on every new runner"): each later runner of a post is pushed once. */
export const runnerKey = (itemId: string, address: string): string => `h:${itemId}|${address}`;
/** The deliverer's claim for a hand-over push: one per person, post and coin (0044), beside the coin's own. */
export const runnerSubject = (itemId: string, address: string): string => `${itemId}|#runner|${address}`;

/** A hand-over push's timing: the coin launched after the post was on For You, and is still just launched. No coin-first exception: the new coin always came after. */
export function runnerEarlyEnough(p: Pick<Picked, 'launchedMs' | 'onForYouMs' | 'runningNow'>, nowMs: number, rule: LaunchAges): boolean {
  return p.launchedMs !== null && youngEnough(p, nowMs, rule) && p.launchedMs >= p.onForYouMs;
}

/** Whether the coin is a launchpad coin by its stored row; the launch timing is rule 2's, not the gate's. */
export const onLaunchpad = (f: CoinGateFacts | undefined): boolean => f !== undefined && coinGate(f) !== 'not_launchpad';

/** Where a tap on the push lands: the coin's own chart (mobile shared/route.ts `token`), never the post. */
export const launchHref = (p: Pick<Picked, 'address'>): string => tokenHref(p.address);

/** Whether the push's timing rule passes: launched after For You (rule 2) or, for a coin-first post, its first pick; and just launched (rule 3). */
export function earlyEnough(p: Pick<Picked, 'address' | 'launchedMs' | 'onForYouMs' | 'coinFirst' | 'runningNow'>, nowMs: number, rule: LaunchAges): boolean {
  if (p.launchedMs === null || !youngEnough(p, nowMs, rule)) return false;
  if (p.launchedMs >= p.onForYouMs) return true;
  /* A coin-first post: its first pick is the first coin to run; rule 1 keeps it to one. */
  return p.coinFirst !== undefined;
}

/**
 * The pure step. `posts` before `narratives`: a post's own card is the better push. Returns what to
 * push, strongest first, and every key to remember (each subject seen, each coin pushed).
 */
export function launchEvents(
  posts: readonly Picked[],
  narratives: readonly Picked[],
  seen: ReadonlySet<string>,
  nowMs: number,
  rule: LaunchAges,
  runners: ReadonlyMap<string, string> = new Map(),
): { readonly due: readonly Picked[]; readonly keys: readonly string[] } {
  const due: Picked[] = [];
  const keys: string[] = [];
  const pushed = new Set<string>();
  for (const p of [...posts, ...narratives]) {
    /* ★ A revival: an old original back on For You with its promotion's running coin. Once per post, past rules 1 and 2. */
    if (p.revival === true) {
      const vk = revivalKey(p.itemId);
      if (seen.has(vk) || keys.includes(vk)) continue;
      /* Not running now: nothing spent, looked at again next pass. */
      if (!revivalEarlyEnough(p, nowMs, rule)) continue;
      keys.push(vk);
      if (!seen.has(p.key) && !keys.includes(p.key)) keys.push(p.key);
      const coin = `c:${p.address}`;
      if (seen.has(coin) || pushed.has(coin)) continue;
      pushed.add(coin);
      keys.push(coin);
      due.push(p);
      continue;
    }
    /* ★ The runner hand-over: the post's coin moved to a later coin running now. Once per post, past rule 1. */
    const rk = runnerKey(p.itemId, p.address);
    if (p.key.startsWith('p:') && runners.get(p.itemId) === p.address && !seen.has(rk) && !keys.includes(rk)) {
      keys.push(rk);
      if (!seen.has(p.key) && !keys.includes(p.key)) keys.push(p.key);
      const coin = `c:${p.address}`;
      if (!runnerEarlyEnough(p, nowMs, rule) || seen.has(coin) || pushed.has(coin)) continue;
      pushed.add(coin);
      keys.push(coin);
      due.push({ ...p, runner: true });
      continue;
    }
    if (seen.has(p.key) || keys.includes(p.key)) continue;
    const early = earlyEnough(p, nowMs, rule);
    const coin = `c:${p.address}`;
    /* ★ Picked late and quiet now: the post is not spent, so the coin is pushed if it runs before it is a day old. */
    if (!early && !seen.has(coin) && !pushed.has(coin) && (p.coinFirst !== undefined || (p.launchedMs ?? -Infinity) >= p.onForYouMs) && waitsToRun(p, nowMs, rule)) continue;
    keys.push(p.key);
    if (!early || seen.has(coin) || pushed.has(coin)) continue;
    pushed.add(coin);
    keys.push(coin);
    due.push(p);
  }
  due.sort((a, b) => (b.capUsd ?? -1) - (a.capUsd ?? -1));
  return { due, keys };
}

/* ── the database around it ───────────────────────────────────────── */

const https = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/\S+$/.test(v) && v.length <= 2_000 ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const parse = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v);

/* For You posts of the window whose card shows a pick: the current frame's card when it has one, else the scroll's. */
const POSTS_SQL = `
  select f.item_id as "itemId", (extract(epoch from f.first_shown_at) * 1000)::float8 as "onForYouMs",
         c.p -> 'coins' as coins, c.p ->> 'excerpt' as excerpt, c.p ->> 'authorLabel' as author, c.p ->> 'thumbUrl' as image
    from public.feed_post f
    left join public.rising_row r on r.feed_id = 'fyp' and r.item_id = f.item_id
    cross join lateral (select coalesce(r.payload, f.payload) as p) c
   where f.feed_id = 'fyp' and f.withdrawn_at is null and f.first_shown_at > now() - make_interval(secs => $1::float8 / 1000)
     and c.p -> 'coins' -> 'evidence' ->> 'picked' = 'true'`;

/*
 * Narratives on the board with a post found in the window, their page's coin, and their first post:
 * the one we found first, and when (`onForYouMs` carries that moment, rule 2's "we had it first").
 * ★ NOT ONLY THROUGH FOR YOU (the owner, 2026-10-24): $MEMEWAR ran to $94K on France vs Japan, a
 * narrative none of whose posts was ever on For You (the judge called its posts not coinable), and
 * nobody was told. A narrative the Narratives tab shows counts from when we found its first post;
 * that post's For You card, when it has one, gives the push its words and picture.
 */
const NARRATIVES_SQL = `
  with recent as (
    select distinct m.narrative_id from internal.narrative_member m
      join public.item i on i.item_id = m.item_id
     where i.first_seen_at > now() - make_interval(secs => $1::float8 / 1000)
  ), first_post as (
    select distinct on (m.narrative_id) m.narrative_id, i.item_id, i.first_seen_at,
           coalesce(f.payload ->> 'excerpt', left(i.body, 280)) as excerpt, coalesce(f.payload ->> 'authorLabel', '@' || a.handle) as author, f.payload ->> 'thumbUrl' as image
      from recent n join internal.narrative_member m on m.narrative_id = n.narrative_id
      join public.item i on i.item_id = m.item_id
      left join public.author a on a.author_key = i.author_key
      left join public.feed_post f on f.feed_id = 'fyp' and f.item_id = m.item_id and f.withdrawn_at is null
     order by m.narrative_id, i.first_seen_at
  )
  select v.story_id as "storyId", v.payload -> 'coins' as coins, fp.item_id as "itemId", (extract(epoch from fp.first_seen_at) * 1000)::float8 as "onForYouMs",
         fp.excerpt, fp.author, fp.image
    from first_post fp join public.story_view v on v.story_id = fp.narrative_id
   where v.payload #>> '{provenance,kind}' = 'observed' and v.payload #>> '{coins,kind}' in ('one', 'several')`;

/**
 * The posts of these For You let in by the coin-first route alone (0116), each with its first coin.
 * Empty before 0116 or before its grant: looked up first, so no failed statement is ever sent.
 */
async function coinFirstOf(db: Db, itemIds: readonly string[]): Promise<ReadonlyMap<string, string | null>> {
  if (itemIds.length === 0) return new Map();
  const present = await db.query<{ ok: boolean | null }>(
    `select case when to_regclass('internal.coin_first_post') is null then false else has_table_privilege('internal.coin_first_post', 'select') end as ok`,
  );
  if (present[0]?.ok !== true) return new Map();
  const rows = await db.query<{ item_id: string; first_coin_address: string | null }>(
    `select item_id, first_coin_address from internal.coin_first_post where item_id = any($1::text[]) and admitted_at is not null`,
    [[...itemIds]],
  );
  return new Map(rows.map((r) => [r.item_id, r.first_coin_address] as const));
}

export interface LaunchPorts {
  readonly policy: NotifyPolicy;
  readonly now: () => number;
  readonly quotes?: Quotes;
  /** Read the pick at all (Policy.oneCoin.mode 'live'); absent: from the policy in force. */
  readonly onPick?: boolean;
  /** Push the runner hand-over (Policy.runnerLink.handover on and push); absent: from the policy in force. */
  readonly runnerPush?: boolean;
  /** Push a revived original (Policy.rising.promotion on); absent: from the policy in force. */
  readonly revivals?: boolean;
}

/* For You's frame now: each card with a picked coin, its first time on For You (now when it has none), and the post's own time. */
const FRAME_SQL = `
  select r.item_id as "itemId", (extract(epoch from coalesce(f.first_shown_at, now())) * 1000)::float8 as "onForYouMs",
         r.payload -> 'coins' as coins, r.payload ->> 'excerpt' as excerpt, r.payload ->> 'authorLabel' as author, r.payload ->> 'thumbUrl' as image,
         (extract(epoch from coalesce(i.posted_at, i.first_seen_at)) * 1000)::float8 as "postedMs"
    from public.rising_row r
    join public.item i on i.item_id = r.item_id
    left join public.feed_post f on f.feed_id = 'fyp' and f.item_id = r.item_id
   where r.feed_id = 'fyp' and r.payload -> 'coins' -> 'evidence' ->> 'picked' = 'true'`;

/**
 * The frame's picked cards, each post's own time, and the coins picked for each post itself — null
 * without 0129's grant on internal.post_coin_pick (looked up first): then nothing is a revival.
 */
async function frameCards(db: Db): Promise<{
  readonly rows: readonly { itemId: string; onForYouMs: number; coins: unknown; excerpt: string | null; author: string | null; image: string | null; postedMs: number }[];
  readonly postedMs: ReadonlyMap<string, number>;
  readonly ownPicks: ReadonlyMap<string, ReadonlySet<string>> | null;
}> {
  const rows = await db.query<{ itemId: string; onForYouMs: number; coins: unknown; excerpt: string | null; author: string | null; image: string | null; postedMs: number }>(FRAME_SQL);
  const postedMs = new Map(rows.map((r) => [r.itemId, Number(r.postedMs)] as const));
  const [ok] = await db.query<{ ok: boolean | null }>(
    `select case when to_regclass('internal.post_coin_pick') is null then false else has_table_privilege('internal.post_coin_pick', 'select') end as ok`,
  );
  if (ok?.ok !== true || rows.length === 0) return { rows, postedMs, ownPicks: ok?.ok === true ? new Map() : null };
  const own = new Map<string, Set<string>>();
  for (const r of await db.query<{ item_id: string; address: string }>(
    `select item_id, address from internal.post_coin_pick where item_id = any($1::text[]) and outcome = 'picked' and address is not null`,
    [rows.map((r) => r.itemId)],
  )) own.set(r.item_id, new Set([...(own.get(r.item_id) ?? []), r.address]));
  return { rows, postedMs, ownPicks: own };
}

/**
 * The posts of these whose pick the runner hand-over wrote, with the coin it went to. Empty without
 * 0129's grant on internal.post_coin_pick: looked up first, so no failed statement is ever sent.
 */
async function runnerPicks(db: Db, itemIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
  if (itemIds.length === 0) return new Map();
  const [r] = await db.query<{ ok: boolean | null }>(
    `select case when to_regclass('internal.post_coin_pick') is null then false else has_table_privilege('internal.post_coin_pick', 'select') end as ok`,
  );
  if (r?.ok !== true) return new Map();
  const rows = await db.query<{ item_id: string; address: string }>(
    `select item_id, address from internal.post_coin_pick where item_id = any($1::text[]) and outcome = 'picked' and evidence ->> 'runner_handover' = 'true'`,
    [[...itemIds]],
  );
  return new Map(rows.map((x) => [x.item_id, x.address] as const));
}

/** One pass. Returns how many alerts were queued (one per profile per coin). */
export async function checkLaunches(db: Db, ports: LaunchPorts): Promise<number> {
  if (!(ports.onPick ?? DEFAULT_POLICY.oneCoin.mode === 'live')) return 0;
  const L = ports.policy.launch;
  const postRows = await db.query<{ itemId: string; onForYouMs: number; coins: unknown; excerpt: string | null; author: string | null; image: string | null }>(POSTS_SQL, [L.postsWithinMs]);
  const asPicked = (r: { itemId: string; onForYouMs: number; coins: unknown; excerpt: string | null; author: string | null; image: string | null }): Picked[] => {
    const line = lineCoin({ coins: parse(r.coins) });
    if (line === null) return [];
    return [{ key: `p:${r.itemId}`, address: line.address, ticker: line.ticker, onForYouMs: Number(r.onForYouMs), launchedMs: line.mintedAtMs, capUsd: line.mcUsd, itemId: r.itemId, excerpt: text(r.excerpt), author: text(r.author), image: https(r.image), logo: line.imageUrl }];
  };
  /* ★ Revivals (the header): For You's frame now, with each post's own time; the ones not read above are kept only if they are revivals. */
  const frame = (ports.revivals ?? DEFAULT_POLICY.rising.promotion.on) ? await frameCards(db) : null;
  const fromWindow = new Set(postRows.map((r) => r.itemId));
  const posts: Picked[] = [...postRows.flatMap(asPicked), ...(frame?.rows ?? []).filter((r) => !fromWindow.has(r.itemId)).flatMap(asPicked)];
  let narrativeRows: { storyId: string; coins: unknown; itemId: string; onForYouMs: number; excerpt: string | null; author: string | null; image: string | null }[] = [];
  try {
    narrativeRows = await db.query(NARRATIVES_SQL, [L.postsWithinMs]);
  } catch (e) {
    /* Before 0093's grant the narratives are not readable here: the posts alone. */
    if ((e as { code?: unknown }).code !== '42501') throw e;
  }
  const narrativeCoins = narrativeRows.flatMap((r) => {
    const coin = settledCoin(r.coins);
    return coin === null ? [] : [{ r, coin }];
  });
  /* A narrative page's coin carries no launch time or cap: read them as every coin push does. */
  const facts = await coinFacts(db, undefined, [...narrativeCoins.map((n) => n.coin.address), ...posts.filter((p) => p.launchedMs === null).map((p) => p.address)]);
  /* ★ Coin-first posts: the route's record of each, for the first-coin exception to rule 2. */
  const coinFirst = await coinFirstOf(db, posts.map((p) => p.itemId));
  const withLaunch = posts.flatMap((p) => {
    const launched = p.launchedMs !== null ? p : { ...p, launchedMs: facts.get(p.address)?.mintedAtMs ?? null };
    const cf = coinFirst.get(p.itemId);
    const out: Picked = cf === undefined ? launched : { ...launched, coinFirst: { firstCoinAddress: cf } };
    const posted = frame?.postedMs.get(p.itemId);
    const revival = frame !== null && frame.ownPicks !== null && posted !== undefined
      && isRevival({ launchedMs: out.launchedMs, postedMs: posted, ownPick: frame.ownPicks.get(p.itemId)?.has(p.address) === true });
    if (revival) return [{ ...out, revival: true as const }];
    return fromWindow.has(p.itemId) ? [out] : [];
  });
  const narratives: Picked[] = narrativeCoins.map(({ r, coin }) => {
    const f = facts.get(coin.address);
    return { key: `n:${r.storyId}`, address: coin.address, ticker: coin.ticker !== '' ? coin.ticker : (f?.symbol ?? ''), onForYouMs: Number(r.onForYouMs), launchedMs: f?.mintedAtMs ?? null, capUsd: f?.mcUsd ?? null, itemId: r.itemId, excerpt: text(r.excerpt), author: text(r.author), image: https(r.image), logo: f?.logo ?? null };
  });

  const seen = new Set((await db.query<{ key: string }>('select key from people.pipeline_seen where stream = $1', [LAUNCH_STREAM])).map((r) => r.key));
  const remember = async (keys: readonly string[]) => {
    if (keys.length > 0) await db.query('insert into people.pipeline_seen (stream, key) select $1, unnest($2::text[]) on conflict do nothing', [LAUNCH_STREAM, [...keys]]);
  };
  if (!seen.has(SEEDED)) {
    /* The first look: every pick already shown is spent, and nothing is sent. */
    await remember([...[...withLaunch, ...narratives].flatMap((p) => [p.key, `c:${p.address}`]), SEEDED]);
    return 0;
  }
  const runners = (ports.runnerPush ?? (DEFAULT_POLICY.runnerLink.handover.on && DEFAULT_POLICY.runnerLink.handover.push)) ? await runnerPicks(db, withLaunch.map((p) => p.itemId)) : new Map<string, string>();
  /* ★ Late picks (past maxLaunchAgeMs, inside lateRunningMs): each coin's last hour, read only for these. */
  const nowMs = ports.now();
  const late = [...withLaunch, ...narratives].filter((p) => p.launchedMs !== null && (p.revival === true || nowMs - p.launchedMs > L.maxLaunchAgeMs) && nowMs - p.launchedMs <= L.lateRunningMs);
  const hours = late.length === 0 ? new Map() : await lastHours(db, [...new Set(late.map((p) => p.address))], nowMs, DEFAULT_POLICY.market.readingFreshnessMs);
  const mark = (p: Picked): Picked => (late.includes(p) ? { ...p, runningNow: isRunning(hours.get(p.address), ports.policy.savedPost) } : p);
  const events = launchEvents(withLaunch.map(mark), narratives.map(mark), seen, nowMs, L, runners);
  const keys = events.keys;
  /* ★ A launchpad coin only (coin-gate.ts). Rule 2 already keeps the timing; the coin is spent either way. */
  const gate = await coinGateFacts(db, events.due);
  const due = events.due.filter((d) => onLaunchpad(gate.get(`${d.itemId}|${d.address}`)));
  let queued = 0;
  if (due.length > 0) {
    /* The cap the push says: the card's own when it has one, else a fresh read (free). */
    const caps = await coinFacts(db, ports.quotes, due.filter((d) => d.capUsd === null).map((d) => d.address));
    /* ★ The post that started a narrative: its public title, said instead of the normal wording (starting-post.ts). */
    const starts = await startRows(db, due.map((d) => d.itemId));
    for (const d of due) {
      const c = caps.get(d.address);
      const f: Record<string, unknown> = {
        symbol: d.ticker !== '' ? d.ticker : (c?.symbol ?? ''),
        address: d.address,
        excerpt: d.excerpt,
        author: d.author,
        mcUsd: d.capUsd ?? c?.mcUsd ?? null,
        image: d.image,
        logo: d.logo ?? c?.logo ?? null,
        item: d.itemId,
      };
      const started = startedTitle(starts.get(d.itemId), d.launchedMs);
      if (d.runner === true) f['runner'] = true;
      else if (started !== null) f['started'] = started;
      /* Strongest first: one statement per coin, so queue order is cap order. */
      const rows = await db.query<{ n: number }>(
        `with q as (insert into people.alert_queue (user_id, kind, subject, rung, facts, href) select user_id, 'coin_launched', $1, 0, $2, $3 from people.profile returning 1) select count(*)::int as n from q`,
        [d.runner === true ? runnerSubject(d.itemId, d.address) : d.address, JSON.stringify(f), launchHref(d)],
      );
      queued += rows[0]?.n ?? 0;
    }
  }
  await remember(keys);
  return queued;
}
