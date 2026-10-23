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
 *   3. the coin is still "just launched": seen within Policy.notify.launch.maxLaunchAgeMs of its launch.
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

import { coinFacts, type Quotes } from './coin-facts.ts';
import type { Db } from './deliver.ts';
import { settledCoin } from './first-coin.ts';
import { tokenHref } from './pipeline.ts';
import { lineCoin } from './post-watch.ts';

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
}

/** Where a tap on the push lands: the coin's own chart (mobile shared/route.ts `token`), never the post. */
export const launchHref = (p: Pick<Picked, 'address'>): string => tokenHref(p.address);

/** Whether the push's timing rule passes: launched after For You (rule 2) or, for a coin-first post, its first pick; and just launched (rule 3). */
export function earlyEnough(p: Pick<Picked, 'address' | 'launchedMs' | 'onForYouMs' | 'coinFirst'>, nowMs: number, rule: Pick<NotifyPolicy['launch'], 'maxLaunchAgeMs'>): boolean {
  if (p.launchedMs === null || nowMs - p.launchedMs > rule.maxLaunchAgeMs) return false;
  if (p.launchedMs >= p.onForYouMs) return true;
  /* A coin-first post: its first pick is the first coin to run; rule 1 keeps it to one. */
  return p.coinFirst !== undefined;
}

/**
 * The pure step. `posts` before `narratives`: a post's own card is the better push. Returns what to
 * push, strongest first, and every key to remember (each subject seen, each coin pushed).
 */
export function launchEvents(posts: readonly Picked[], narratives: readonly Picked[], seen: ReadonlySet<string>, nowMs: number, rule: Pick<NotifyPolicy['launch'], 'maxLaunchAgeMs'>): { readonly due: readonly Picked[]; readonly keys: readonly string[] } {
  const due: Picked[] = [];
  const keys: string[] = [];
  const pushed = new Set<string>();
  for (const p of [...posts, ...narratives]) {
    if (seen.has(p.key) || keys.includes(p.key)) continue;
    keys.push(p.key);
    const early = earlyEnough(p, nowMs, rule);
    const coin = `c:${p.address}`;
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

/* Narratives with a post on For You in the window, their page's coin, and their first post on For You. */
const NARRATIVES_SQL = `
  with recent as (
    select distinct m.narrative_id from internal.narrative_member m
      join public.feed_post f on f.feed_id = 'fyp' and f.item_id = m.item_id and f.withdrawn_at is null
     where f.first_shown_at > now() - make_interval(secs => $1::float8 / 1000)
  ), first_post as (
    select distinct on (m.narrative_id) m.narrative_id, f.item_id, f.first_shown_at,
           f.payload ->> 'excerpt' as excerpt, f.payload ->> 'authorLabel' as author, f.payload ->> 'thumbUrl' as image
      from recent n join internal.narrative_member m on m.narrative_id = n.narrative_id
      join public.feed_post f on f.feed_id = 'fyp' and f.item_id = m.item_id and f.withdrawn_at is null
     order by m.narrative_id, f.first_shown_at
  )
  select v.story_id as "storyId", v.payload -> 'coins' as coins, fp.item_id as "itemId", (extract(epoch from fp.first_shown_at) * 1000)::float8 as "onForYouMs",
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
}

/** One pass. Returns how many alerts were queued (one per profile per coin). */
export async function checkLaunches(db: Db, ports: LaunchPorts): Promise<number> {
  if (!(ports.onPick ?? DEFAULT_POLICY.oneCoin.mode === 'live')) return 0;
  const L = ports.policy.launch;
  const postRows = await db.query<{ itemId: string; onForYouMs: number; coins: unknown; excerpt: string | null; author: string | null; image: string | null }>(POSTS_SQL, [L.postsWithinMs]);
  const posts: Picked[] = postRows.flatMap((r) => {
    const line = lineCoin({ coins: parse(r.coins) });
    if (line === null) return [];
    return [{ key: `p:${r.itemId}`, address: line.address, ticker: line.ticker, onForYouMs: Number(r.onForYouMs), launchedMs: line.mintedAtMs, capUsd: line.mcUsd, itemId: r.itemId, excerpt: text(r.excerpt), author: text(r.author), image: https(r.image), logo: line.imageUrl }];
  });
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
  const withLaunch = posts.map((p) => {
    const launched = p.launchedMs !== null ? p : { ...p, launchedMs: facts.get(p.address)?.mintedAtMs ?? null };
    const cf = coinFirst.get(p.itemId);
    return cf === undefined ? launched : { ...launched, coinFirst: { firstCoinAddress: cf } };
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
  const { due, keys } = launchEvents(withLaunch, narratives, seen, ports.now(), L);
  let queued = 0;
  if (due.length > 0) {
    /* The cap the push says: the card's own when it has one, else a fresh read (free). */
    const caps = await coinFacts(db, ports.quotes, due.filter((d) => d.capUsd === null).map((d) => d.address));
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
      /* Strongest first: one statement per coin, so queue order is cap order. */
      const rows = await db.query<{ n: number }>(
        `with q as (insert into people.alert_queue (user_id, kind, subject, rung, facts, href) select user_id, 'coin_launched', $1, 0, $2, $3 from people.profile returning 1) select count(*)::int as n from q`,
        [d.address, JSON.stringify(f), launchHref(d)],
      );
      queued += rows[0]?.n ?? 0;
    }
  }
  await remember(keys);
  return queued;
}
