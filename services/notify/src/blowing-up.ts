/**
 * BLOWING UP ON FOR YOU (the owner's notification design, 2026-10-18): the few For You posts and
 * brand-new narratives worth a push, at most three a day per person, the rest only listed.
 *
 * ★ THE SAME RISERS PEOPLE SEE. A post is a candidate only when it is a riser of Trending now by
 * the one rule both the read service and the runner use (core `riserPlace`: its views a minute over
 * the last half hour against the hour before, from its own readings), is in that list's first
 * Policy.notify.blowingUp.topN, and gains at least `minPerMin` views a minute now. A second copy of
 * the rule here would push posts the app does not show as trending the first time one changed.
 *
 * ★ NO COIN YET GOES FIRST. A pass queues posts whose line says no coin (and that list none sharing
 * their name) before a brand-new narrative, and both before a post that already has a coin; the
 * push says "Rising fast, no coin yet". A post or narrative is a candidate once, ever (stream
 * `blowing-up` in people.pipeline_seen). A post in a narrative is a post like any other.
 *
 * ★ THE ALLOWANCE IS THE DELIVERER'S. This queues each pick for every profile (a narrative's
 * starrers are left out: theirs is the starred narrative's own speed push, starred.ts); the
 * deliverer pushes it only while the person is under `perDay` in the day and `minGapMs` since the
 * last (core `underDailyAllowance`), and lists it otherwise. Queue order is pick order, so the
 * first pick of a pass is the one that reaches the phone.
 *
 * ★ THE FIRST LOOK SENDS NOTHING: what qualifies when the stream is first read is remembered, so a
 * deploy never pushes about the board as it already was.
 *
 * What breaks if changed carelessly: marking every riser seen rather than only the picks would burn
 * a post that was fourth this pass and first the next; queueing in rank order alone would let a
 * coined post take the day's slot from a coinless one in the same pass.
 */

import type { Policy } from '@insidor/contracts';
import { riserPlace, sortGainIn, sortOrder, sortRunsOf, type SortReading } from '@insidor/core';

import { queue, type Db } from './deliver.ts';
import { posterPictures } from './faces.ts';
import { postHref } from './pipeline.ts';
import { lineCoin } from './post-watch.ts';
import type { Facts } from './text.ts';

export const BLOWING_UP_STREAM = 'blowing-up';
const SEEDED = '#seeded';
/** The source whose views are ranked at the short-video scale, as the read service and the runner name it. */
const SHORT_VIDEO_SOURCE = 'tiktok';

export interface RiserPost {
  readonly itemId: string;
  readonly source: string | null;
  readonly postedMs: number | null;
  readonly readings: readonly SortReading[];
  /** The card's coins, as the projector wrote them. */
  readonly coins: unknown;
  /** Whether the post's coin list names any coin sharing its name. */
  readonly listed: boolean;
  readonly author: string | null;
  readonly excerpt: string | null;
  readonly views: number | null;
  readonly image: string | null;
}

export interface NewNarrative {
  readonly storyId: string;
  readonly title: string;
  readonly firstSeenMs: number | null;
  readonly dead: boolean;
  readonly newPosts: number | null;
  readonly viewsGained: number | null;
}

export interface BlowingPick {
  readonly key: string;
  readonly what: 'post' | 'narrative';
  readonly noCoin: boolean;
  readonly facts: Facts;
  readonly href: string;
}

/** No coin: the line says none, and no coin shares its name. Pending, unsure or unknown is not "no coin". */
export const hasNoCoin = (p: Pick<RiserPost, 'coins' | 'listed'>): boolean => {
  const c = (typeof p.coins === 'string' ? JSON.parse(p.coins) : p.coins) as { kind?: unknown } | null;
  return c?.kind === 'none' && !p.listed;
};

/** The posts blowing up now, in pick order (no coin first, then by the riser order), not yet seen. */
export function blowingUpPosts(posts: readonly RiserPost[], nowMs: number, policy: Policy, seen: ReadonlySet<string>): BlowingPick[] {
  const b = policy.notify.blowingUp;
  const r = policy.rising.forYouSorts.risers;
  const byId = new Map(posts.map((p) => [p.itemId, p]));
  const places = posts.flatMap((p) => {
    const one = riserPlace(p.itemId, p.readings, p.postedMs, nowMs, policy, p.source === SHORT_VIDEO_SOURCE ? policy.rising.shortVideoReachScale : 1);
    return one === null || !one.fresh ? [] : [one];
  });
  const top = sortOrder(places, b.topN).filter((x) => (x.speed ?? 0) >= b.minPerMin && !seen.has(x.id));
  return top.flatMap((x): BlowingPick[] => {
    const p = byId.get(x.id);
    if (p === undefined) return [];
    const runs = sortRunsOf(p.readings).runs;
    const gain = sortGainIn(runs, nowMs - r.nowSpanMs, nowMs);
    const line = lineCoin(p.coins === null ? null : { coins: typeof p.coins === 'string' ? JSON.parse(p.coins) : p.coins });
    const noCoin = hasNoCoin(p);
    return [{
      key: p.itemId,
      what: 'post',
      noCoin,
      facts: {
        what: 'post',
        author: p.author,
        excerpt: p.excerpt ?? '',
        views: p.views,
        gain: Math.round(gain),
        gainMinutes: Math.round(r.nowSpanMs / 60_000),
        image: p.image,
        noCoin,
        ...(line === null ? {} : { symbol: line.ticker, address: line.address, mcUsd: line.mcUsd }),
      },
      href: postHref(p.itemId),
    }];
  });
}

/** Brand-new narratives taking off: found under `newNarrativeMaxAgeMs` ago, live, with the last hour's posts and views over the bars. */
export function blowingUpNarratives(stories: readonly NewNarrative[], nowMs: number, policy: Policy, seen: ReadonlySet<string>): BlowingPick[] {
  const b = policy.notify.blowingUp;
  return stories
    .filter((s) => !s.dead && s.firstSeenMs !== null && nowMs - s.firstSeenMs <= b.newNarrativeMaxAgeMs && (s.newPosts ?? 0) >= b.newNarrativeMinPosts && (s.viewsGained ?? 0) >= b.newNarrativeMinReach && !seen.has(s.storyId))
    .sort((a, z) => (z.viewsGained ?? 0) - (a.viewsGained ?? 0) || (a.storyId < z.storyId ? -1 : 1))
    .map((s) => ({ key: s.storyId, what: 'narrative' as const, noCoin: false, facts: { what: 'narrative', title: s.title, newPosts: s.newPosts, viewsGained: s.viewsGained }, href: `/#/story/${encodeURIComponent(s.storyId)}` }));
}

/** The pass's picks in the order they are queued: coinless posts, then new narratives, then posts with a coin; at most `perPass`. */
export function pickOrder(posts: readonly BlowingPick[], narratives: readonly BlowingPick[], perPass: number): BlowingPick[] {
  return [...posts.filter((p) => p.noCoin), ...narratives, ...posts.filter((p) => !p.noCoin)].slice(0, perPass);
}

/* ── the database around it ───────────────────────────────────────── */

/* For You's live cards from the last two hours: Trending now needs 90 minutes of readings at most. */
const POSTS_SQL = `
select f.item_id as "itemId", i.source, coalesce(f.payload #> '{sheet,counts}', f.payload #> '{sheet,views}') as readings,
       f.payload #>> '{postedAt,at}' as "postedMs", f.payload -> 'coins' as coins, f.payload ->> 'authorLabel' as author,
       f.payload ->> 'excerpt' as excerpt, (f.payload #>> '{reach,v}')::float8 as views, f.payload ->> 'thumbUrl' as image
  from public.feed_post f left join public.item i on i.item_id = f.item_id
 where f.feed_id = 'fyp' and f.withdrawn_at is null and f.payload is not null and f.payload_at >= now() - interval '2 hours'`;

const NARRATIVES_SQL = `
select story_id as "storyId", coalesce(payload ->> 'title', '') as title, (payload #>> '{firstSeenAt,at}')::float8 as "firstSeenMs", dead,
       (select (w ->> 'newPosts')::float8 from jsonb_array_elements(payload -> 'inWindow') w where (w ->> 'hours')::int = 1 limit 1) as "newPosts",
       (select (w #>> '{viewsGained,v}')::float8 from jsonb_array_elements(payload -> 'inWindow') w where (w ->> 'hours')::int = 1 limit 1) as "viewsGained"
  from public.story_view where payload #>> '{provenance,kind}' = 'observed' and jsonb_typeof(payload -> 'inWindow') = 'array'`;

const readingsOf = (raw: unknown): SortReading[] => {
  const list = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(list)) return [];
  return list.flatMap((r) => {
    const o = typeof r === 'object' && r !== null ? (r as Record<string, unknown>) : {};
    return typeof o['atMs'] === 'number' ? [{ atMs: o['atMs'], value: typeof o['value'] === 'number' ? o['value'] : null }] : [];
  });
};
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const https = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/\S+$/.test(v) && v.length <= 2_000 ? v : null);

export async function readRiserPosts(db: Db): Promise<RiserPost[]> {
  const rows = await db.query<{ itemId: string; source: string | null; readings: unknown; postedMs: string | null; coins: unknown; author: string | null; excerpt: string | null; views: number | null; image: string | null }>(POSTS_SQL);
  let listed = new Set<string>();
  try {
    listed = new Set((await db.query<{ id: string }>(`select distinct subject_id as id from public.same_name_coin where subject_kind = 'post' and subject_id = any($1::text[])`, [rows.map((r) => r.itemId)])).map((r) => r.id));
  } catch (e) {
    if ((e as { code?: unknown }).code !== '42501') throw e;
  }
  return rows.map((r) => ({ itemId: r.itemId, source: r.source, postedMs: num(r.postedMs), readings: readingsOf(r.readings), coins: r.coins, listed: listed.has(r.itemId), author: r.author, excerpt: r.excerpt, views: num(r.views), image: https(r.image) }));
}

export async function readNewNarratives(db: Db): Promise<NewNarrative[]> {
  return (await db.query<{ storyId: string; title: string; firstSeenMs: number | null; dead: boolean; newPosts: number | null; viewsGained: number | null }>(NARRATIVES_SQL)).map((r) => ({ ...r, firstSeenMs: num(r.firstSeenMs), newPosts: num(r.newPosts), viewsGained: num(r.viewsGained) }));
}

/** One pass. Returns how many alerts were queued. */
export async function checkBlowingUp(db: Db, policy: Policy, nowMs: number): Promise<number> {
  const seenRows = await db.query<{ key: string }>('select key from people.pipeline_seen where stream = $1', [BLOWING_UP_STREAM]);
  const seen = new Set(seenRows.map((r) => r.key));
  const seeded = seen.delete(SEEDED);
  const posts = blowingUpPosts(await readRiserPosts(db), nowMs, policy, seen);
  const narratives = blowingUpNarratives(await readNewNarratives(db), nowMs, policy, seen);
  const remember = async (keys: readonly string[]) => {
    if (keys.length > 0) await db.query('insert into people.pipeline_seen (stream, key) select $1, unnest($2::text[]) on conflict do nothing', [BLOWING_UP_STREAM, [...keys]]);
  };
  if (!seeded) {
    await remember([SEEDED, ...posts.map((p) => p.key), ...narratives.map((p) => p.key)]);
    return 0;
  }
  const picks = pickOrder(posts, narratives, policy.notify.blowingUp.perPass);
  if (picks.length === 0) return 0;
  const people = (await db.query<{ userId: string }>('select user_id as "userId" from people.profile')).map((p) => p.userId);
  const pictures = await posterPictures(db, picks.filter((p) => p.what === 'post').map((p) => p.key));
  let queued = 0;
  for (const p of picks) {
    const starrers = p.what === 'narrative' ? new Set((await db.query<{ userId: string }>('select user_id as "userId" from people.watch where story_id = $1', [p.key])).map((w) => w.userId)) : new Set<string>();
    const picture = pictures.get(p.key);
    const facts = picture === undefined ? p.facts : { ...p.facts, picture };
    for (const userId of people) {
      if (starrers.has(userId)) continue;
      await queue(db, { userId, kind: 'blowing_up', subject: p.key, rung: 0, facts, href: p.href });
      queued += 1;
    }
  }
  await remember(picks.map((p) => p.key));
  return queued;
}
