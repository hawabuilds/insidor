/**
 * A SAVED POST ALWAYS PUSHES (the owner, 2026-10-24, after $KURIBO: he saved @AOYAN_xD's Kuribo
 * video at 17:11 UTC, $KURIBO launched from it at 22:47, and he heard nothing until 23:54 — and then
 * only in the list, because the push waited for the one-coin rule's confirmation and the deliverer
 * treated a saved post's coin as list-only behind the daily cap).
 *
 * At most TWO pushes per person and saved post, both `watched_first_coin`, both pushed past the hourly
 * limit and outside the launch push's daily cap (core alerts.ts PUSHED_KINDS, PAST_THE_LIMIT,
 * UNCOUNTED_PUSH_KINDS):
 *
 *   1. "$X launched from a post you saved" — the FIRST coin tied to the post, launched AFTER the
 *      person saved it, that STARTS RUNNING. Tied: a candidate the runner's launch matcher wrote for
 *      the post (internal.one_coin_candidate, by a link to the post or an exact name — the judge's
 *      names, the namer's guesses, or the post's own words; a picture alone is not enough), or the
 *      coin that brought the post in by its link (internal.coin_first_post). Running: the running
 *      coins strip's test (services/read running-coins.ts) with this push's own, higher bars, on the
 *      coin's latest market reading inside Policy.market.readingFreshnessMs —
 *      Policy.notify.savedPost.minVolume1hUsd dollars AND minTrades1h trades in its last hour (0127).
 *      A coin with no reading yet, or a reading without its hour, is not running. Two at once: the
 *      busier hour. It does not wait for the one-coin pick.
 *      Why running (the owner, 2026-10-24, after the first replay): "first tied coin" alone would have
 *      pushed a $2.9K dud "$Kuribo" at 19:33, three hours before $KURIBO; five duds linked or named
 *      the post before the real coin launched. Why not the strip's $1,000: the $729 $KURIBOO passed it
 *      at 23:28 and rugged five minutes later (the measurement is at the policy field).
 *   2. "$X is the one running for a post you saved" — once, when the one-coin rule's pick
 *      (internal.post_coin_pick; with none, the card's line coin) is a DIFFERENT coin from push 1.
 *
 * ★ THE COIN GATE HOLDS FOR BOTH (coin-gate.ts): a launchpad coin by its stored row, launched after
 * the post. Push 1 also needs the launch after the save — a coin that was there when the star was
 * tapped is not news — and within Policy.notify.launch.maxLaunchAgeMs of now: a coin that starts
 * running later than that is not "just launched", and the post waits for its pick.
 *
 * ★ A PICK THAT CAME FIRST SETTLES IT. When the rule has picked a coin before any push 1 went, that
 * pick is push 1 if it qualifies, and is otherwise remembered silently as the post's coin — so a
 * coin tied later is never announced "launched from a post you saved" over a coin already running.
 *
 * Remembered per person in the seen stream (`watch:<person>`): `<post>|#saved-first|<coin>` and
 * `<post>|#saved-running`, whether or not the push reached a phone. The first look of this rule
 * (`watch-saved`, `#seeded`) remembers what every saved post already has and sends nothing.
 *
 * How fast: the market reader runs every five minutes (tools/railway-start.mjs `market`) and reads
 * every coin tied to a saved post while it is just launched (services/market db.ts, 0129's
 * internal.saved_post_coins); this runs every Policy.notify.watchLoopMs and the deliverer every
 * Policy.notify.deliverLoopMs. So push 1 lands seconds after the first market pass at which the coin
 * clears the bar: about 1–6 minutes after launch for a coin that runs at once.
 *
 * Reads internal.one_coin_candidate and internal.post_coin_pick by 0129's grant, and
 * public.market_reading by 0078's; without 0129 only coin_first_post and the card's line coin are
 * read — looked up first, so no failed statement is sent.
 *
 * What breaks if changed carelessly: remembering only pushes that went — a pick that came first
 * must be remembered too, or a later tie is announced as the first and the post goes past two
 * pushes. And reading a missing hour as a quiet one or a busy one: it is neither, and waits.
 */

import { DEFAULT_POLICY, type NotifyPolicy, type Policy } from '@insidor/contracts/policy.ts';

import { coinFacts, type Quotes } from './coin-facts.ts';
import { coinGate, coinGateFacts, type CoinGateFacts } from './coin-gate.ts';
import { queue, type Db } from './deliver.ts';
import { tokenHref } from './pipeline.ts';
import { lineCoin, watchStream } from './post-watch.ts';

/** Marks that this rule's first look remembered what every saved post already had. */
export const SAVED_STREAM = 'watch-saved';
const SEEDED = '#seeded';

/** The ties that make a coin a saved post's: a link to it, or an exact name. A picture alone is not one. Kept equal to 0129's internal.saved_post_coins. */
export const SAVED_TIES = ['link', 'name_judge', 'name_guess', 'name_text'] as const;

export const firstSavedKey = (itemId: string, address: string): string => `${itemId}|#saved-first|${address}`;
export const runningSavedKey = (itemId: string): string => `${itemId}|#saved-running`;

/* ── pure ─────────────────────────────────────────────────────────── */

/** Dollars traded and trades (buys plus sells) in the hour before a market reading. */
export interface LastHour {
  readonly volume1hUsd: number;
  readonly trades1h: number;
}

export interface SavedCoin {
  readonly address: string;
  readonly gate: CoinGateFacts;
  /** The coin's last hour from its latest fresh market reading (0127); null or absent when there is none, or it carried no hour. */
  readonly hour?: LastHour | null;
}

type RunningBars = Pick<Policy['runningCoins'], 'minVolume1hUsd' | 'minTrades1h'>;

/** The running coins strip's test (services/read running-coins.ts), on whatever bars it is given: enough dollars AND enough trades. No hour is not running. */
export const isRunning = (hour: LastHour | null | undefined, bars: RunningBars): boolean =>
  hour !== null && hour !== undefined && hour.volume1hUsd >= bars.minVolume1hUsd && hour.trades1h >= bars.minTrades1h;

/** The bars push 1 is held to: just launched (Policy.notify.launch.maxLaunchAgeMs) and running (Policy.notify.savedPost). */
export interface SavedRule {
  readonly maxLaunchAgeMs: number;
  readonly running: RunningBars;
}

/** What this person already heard about this saved post: push 1's coin (or the coin remembered in its place), and whether push 2 is spent. */
export interface SavedMemory {
  readonly first: string | null;
  readonly running: boolean;
}

export interface SavedStep {
  readonly push: { readonly kind: 'first' | 'running'; readonly address: string } | null;
  readonly remember: readonly string[];
}

/**
 * One saved post, one look. `ties` are the coins tied to it (any order), each with its last hour;
 * `pick` the rule's coin now, null while it is waiting. `seeding`: remember, never push.
 */
export function savedPostStep(itemId: string, savedMs: number, ties: readonly SavedCoin[], pick: SavedCoin | null, mem: SavedMemory, nowMs: number, rule: SavedRule, seeding: boolean): SavedStep {
  const passes = (c: SavedCoin) => coinGate(c.gate) === null;
  const afterSave = (c: SavedCoin) => c.gate.launchedMs !== null && c.gate.launchedMs >= savedMs;
  const fresh = (c: SavedCoin) => c.gate.launchedMs !== null && nowMs - c.gate.launchedMs <= rule.maxLaunchAgeMs;
  if (mem.first === null) {
    if (pick !== null) {
      const remember = [firstSavedKey(itemId, pick.address)];
      if (!seeding && passes(pick) && afterSave(pick) && fresh(pick)) return { push: { kind: 'first', address: pick.address }, remember };
      return { push: null, remember: seeding ? [...remember, runningSavedKey(itemId)] : remember };
    }
    /* The first tied coin to START RUNNING while it is just launched; two at once: the busier hour, then the address. */
    const first = [...ties]
      .filter((c) => passes(c) && afterSave(c) && fresh(c) && isRunning(c.hour, rule.running))
      .sort((a, b) => (b.hour?.volume1hUsd ?? 0) - (a.hour?.volume1hUsd ?? 0) || a.address.localeCompare(b.address))[0];
    if (first === undefined) return { push: null, remember: [] };
    return { push: seeding ? null : { kind: 'first', address: first.address }, remember: [firstSavedKey(itemId, first.address)] };
  }
  if (mem.running || pick === null || pick.address === mem.first || !passes(pick)) return { push: null, remember: [] };
  return { push: seeding ? null : { kind: 'running', address: pick.address }, remember: [runningSavedKey(itemId)] };
}

/** This person's memory of one saved post, from their seen keys. */
export function savedMemory(itemId: string, keys: ReadonlySet<string>): SavedMemory {
  const prefix = `${itemId}|#saved-first|`;
  let first: string | null = null;
  for (const k of keys) if (k.startsWith(prefix)) first = k.slice(prefix.length);
  return { first, running: keys.has(runningSavedKey(itemId)) };
}

/* ── the database around it ───────────────────────────────────────── */

export interface SavedWatch {
  readonly userId: string;
  readonly itemId: string;
  readonly since: number;
}
export interface SavedPost {
  readonly author: string | null;
  readonly excerpt: string | null;
  readonly image: string | null;
  readonly picture: string | null;
  readonly payload: unknown;
}
export interface SavedPorts {
  readonly policy: NotifyPolicy;
  readonly now: () => number;
  readonly quotes?: Quotes;
  /** The running bars and how old a market reading may be; absent: Policy.notify.savedPost and Policy.market.readingFreshnessMs. */
  readonly running?: RunningBars;
  readonly readingFreshnessMs?: number;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** Each coin's last hour from its latest market reading inside the freshness window; a latest reading without an hour is no hour (0127's "not read"). */
async function lastHours(db: Db, addresses: readonly string[], nowMs: number, freshMs: number): Promise<Map<string, LastHour>> {
  const out = new Map<string, LastHour>();
  if (addresses.length === 0) return out;
  const rows = await db.query<{ address: string; v: unknown; b: unknown; s: unknown }>(
    `select distinct on (address) address, volume_1h_usd as v, buys_1h as b, sells_1h as s from public.market_reading
      where chain = 'solana' and address = any($1::text[]) and taken_at > to_timestamp($2::float8 / 1000)
      order by address, taken_at desc`,
    [[...addresses], nowMs - freshMs],
  );
  for (const r of rows) {
    const v = num(r.v);
    const b = num(r.b);
    const s = num(r.s);
    if (v !== null && b !== null && s !== null) out.set(r.address, { volume1hUsd: v, trades1h: b + s });
  }
  return out;
}

/** Whether this role may read the runner's candidates and picks (0129). */
async function readable(db: Db): Promise<{ candidates: boolean; picks: boolean }> {
  const [r] = await db.query<{ c: boolean | null; p: boolean | null }>(
    `select case when to_regclass('internal.one_coin_candidate') is null then false else has_table_privilege('internal.one_coin_candidate', 'select') end as c,
            case when to_regclass('internal.post_coin_pick') is null then false else has_table_privilege('internal.post_coin_pick', 'select') end as p`,
  );
  return { candidates: r?.c === true, picks: r?.p === true };
}

/** One look over every saved post still open. Returns how many alerts were queued. */
export async function checkSavedPosts(db: Db, ports: SavedPorts, watches: readonly SavedWatch[], posts: ReadonlyMap<string, SavedPost>): Promise<number> {
  if (watches.length === 0) return 0;
  const seeding = (await db.query(`select 1 from people.pipeline_seen where stream = $1 and key = $2`, [SAVED_STREAM, SEEDED])).length === 0;
  const streams = [...new Set(watches.map((w) => watchStream(w.userId)))];
  const seenRows = await db.query<{ stream: string; key: string }>(`select stream, key from people.pipeline_seen where stream = any($1::text[]) and key like '%|#saved-%'`, [streams]);
  const keysOf = new Map<string, Set<string>>();
  for (const r of seenRows) keysOf.set(r.stream, (keysOf.get(r.stream) ?? new Set()).add(r.key));
  const open = watches.filter((w) => !(keysOf.get(watchStream(w.userId))?.has(runningSavedKey(w.itemId)) ?? false));
  if (open.length === 0 && !seeding) return 0;
  const itemIds = [...new Set(open.map((w) => w.itemId))];
  const earliest = Math.min(...open.map((w) => w.since));

  const can = await readable(db);
  const tiedTo = new Map<string, Set<string>>();
  const tie = (itemId: string, address: string | null) => {
    if (address !== null && address !== '') tiedTo.set(itemId, (tiedTo.get(itemId) ?? new Set()).add(address));
  };
  if (itemIds.length > 0 && can.candidates) {
    /* A minute of slack: the candidate's launch time and the stored row's can differ by seconds; the gate decides on the row's. */
    for (const c of await db.query<{ itemId: string; address: string }>(
      `select item_id as "itemId", address from internal.one_coin_candidate
        where item_id = any($1::text[]) and launched_at >= to_timestamp($2::float8 / 1000) - interval '1 minute' and evidence -> 'ties' ?| $3::text[]`,
      [itemIds, earliest, [...SAVED_TIES]],
    )) tie(c.itemId, c.address);
  }
  if (itemIds.length > 0) {
    for (const c of await db.query<{ itemId: string; coin: string; first: string | null }>(`select item_id as "itemId", coin_address as coin, first_coin_address as first from internal.coin_first_post where item_id = any($1::text[])`, [itemIds])) {
      tie(c.itemId, c.coin);
      tie(c.itemId, c.first);
    }
  }
  /* The pick as the runner decided it; else the card's coin (the pick as projected, or the owner's coin for its story). */
  const picks = new Map<string, string>();
  if (itemIds.length > 0 && can.picks) {
    for (const p of await db.query<{ itemId: string; address: string }>(`select item_id as "itemId", address from internal.post_coin_pick where item_id = any($1::text[]) and outcome = 'picked'`, [itemIds])) picks.set(p.itemId, p.address);
  }
  for (const id of itemIds) {
    const line = lineCoin(posts.get(id)?.payload ?? null);
    if (line !== null && !picks.has(id)) picks.set(id, line.address);
  }
  const pairs = itemIds.flatMap((id) => [...new Set([...(tiedTo.get(id) ?? []), ...(picks.has(id) ? [picks.get(id) ?? ''] : [])])].map((address) => ({ itemId: id, address })));
  const gates = await coinGateFacts(db, pairs);
  const now = ports.now();
  const hours = await lastHours(db, [...new Set(pairs.map((p) => p.address))], now, ports.readingFreshnessMs ?? DEFAULT_POLICY.market.readingFreshnessMs);
  const coinOf = (itemId: string, address: string): SavedCoin => ({ address, gate: gates.get(`${itemId}|${address}`) ?? { venueId: null, origin: null, launchedMs: null, hadPostMs: null }, hour: hours.get(address) ?? null });
  const rule: SavedRule = { maxLaunchAgeMs: ports.policy.launch.maxLaunchAgeMs, running: ports.running ?? ports.policy.savedPost };

  const remember: { stream: string; key: string }[] = [];
  const due: { w: SavedWatch; kind: 'first' | 'running'; address: string }[] = [];
  for (const w of open) {
    const stream = watchStream(w.userId);
    const ties = [...(tiedTo.get(w.itemId) ?? [])].map((a) => coinOf(w.itemId, a));
    const pickAddress = picks.get(w.itemId);
    const step = savedPostStep(w.itemId, w.since, ties, pickAddress === undefined ? null : coinOf(w.itemId, pickAddress), savedMemory(w.itemId, keysOf.get(stream) ?? new Set()), now, rule, seeding);
    for (const key of step.remember) remember.push({ stream, key });
    if (step.push !== null) due.push({ w, ...step.push });
  }

  const coins = await coinFacts(db, ports.quotes, due.map((d) => d.address));
  for (const { w, kind, address } of due) {
    const post = posts.get(w.itemId);
    const coin = coins.get(address);
    const facts: Record<string, unknown> = {
      saved: kind === 'first' ? 'launched' : 'running',
      symbol: coin?.symbol ?? '',
      address,
      item: w.itemId,
      author: post?.author ?? null,
      excerpt: post?.excerpt ?? null,
      ageMs: coin?.mintedAtMs === null || coin?.mintedAtMs === undefined ? null : Math.max(0, now - coin.mintedAtMs),
      mcUsd: coin?.mcUsd ?? null,
      change24h: coin?.change24h ?? null,
      image: post?.image ?? null,
      logo: coin?.logo ?? null,
      ...(post?.picture ? { picture: post.picture } : {}),
    };
    /* One claim per post for each of the two (`<post>|#launched`, `<post>|#running`): never an older claim on the post itself, which the earlier first-coin rule took. */
    await queue(db, { userId: w.userId, kind: 'watched_first_coin', subject: `${w.itemId}|${kind === 'first' ? '#launched' : '#running'}`, rung: 0, facts, href: tokenHref(address) });
  }
  if (remember.length > 0) {
    await db.query('insert into people.pipeline_seen (stream, key) select unnest($1::text[]), unnest($2::text[]) on conflict do nothing', [remember.map((r) => r.stream), remember.map((r) => r.key)]);
  }
  if (seeding) await db.query(`insert into people.pipeline_seen (stream, key) values ($1, $2) on conflict do nothing`, [SAVED_STREAM, SEEDED]);
  return due.length;
}
