/**
 * NEWS ABOUT A NARRATIVE YOU STARRED (the owner's notification design, 2026-10-18), beyond its
 * first coin (first-coin.ts):
 *
 *   picks up speed   "Pancake the cat is taking off" / "6 new posts, +2.1M views in the last hour":
 *                    its last hour (the page's own `inWindow` 1h: new posts, views gained) over
 *                    Policy.notify.starredSpeed's bars, and its views a minute now at least
 *                    `minRatio` times the half hour before when that is known
 *   a big account    an account with Policy.notify.bigAccount.minFollowers followers or more posts
 *                    in it: "@account posted in Pancake the cat" / "48M followers: words…"
 *
 * Both are facts the page already shows (posts, views, followers), never the order's number.
 *
 * ★ PACED PER NARRATIVE BY THE DELIVERER (core `pacingOf`): one push per person and narrative every
 * `gapMs`; one more inside it is listed. The speed alert's level is the `gapMs` window it fell in,
 * so a narrative that stays fast is queued once a window, not every pass.
 *
 * ★ THE FIRST LOOK SENDS NOTHING. The big-account stream (`big-account`, "narrative|post") is seeded
 * with every such post already in a starred narrative; the speed check skips its first pass. So a
 * deploy does not push about the narratives as they already were.
 *
 * What breaks if changed carelessly: reading the board's narratives instead of every page — most
 * starred narratives are off the board; and counting a post's age from when it joined rather than
 * when it was posted, which would push about a week-old post the regroup just added.
 */

import type { NotifyPolicy } from '@insidor/contracts/policy.ts';

import { queue, type Db } from './deliver.ts';
import { posterPictures } from './faces.ts';

export const BIG_ACCOUNT_STREAM = 'big-account';
const SPEED_STREAM = 'starred-speed';
const SEEDED = '#seeded';
const storyHref = (id: string) => `/#/story/${encodeURIComponent(id)}`;

export interface StarredPage {
  readonly storyId: string;
  readonly title: string;
  readonly dead: boolean;
  readonly newPosts: number | null;
  readonly viewsGained: number | null;
  /** Views a minute over the last half hour and the half hour before; null when not measured. */
  readonly perMinNow: number | null;
  readonly perMinBefore: number | null;
}

/** Whether a starred narrative is picking up speed now. Pure. */
export function takingOff(p: StarredPage, P: NotifyPolicy): boolean {
  const r = P.starredSpeed;
  if (p.dead || (p.newPosts ?? 0) < r.minNewPosts || (p.viewsGained ?? 0) < r.minReach) return false;
  if (p.perMinNow === null || p.perMinBefore === null || p.perMinBefore <= 0) return true;
  return p.perMinNow >= r.minRatio * p.perMinBefore;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

const PAGES_SQL = `
select story_id as "storyId", coalesce(payload ->> 'title', '') as title, dead,
       (select (w ->> 'newPosts')::float8 from jsonb_array_elements(case when jsonb_typeof(payload -> 'inWindow') = 'array' then payload -> 'inWindow' else '[]' end) w where (w ->> 'hours')::int = 1 limit 1) as "newPosts",
       (select (w #>> '{viewsGained,v}')::float8 from jsonb_array_elements(case when jsonb_typeof(payload -> 'inWindow') = 'array' then payload -> 'inWindow' else '[]' end) w where (w ->> 'hours')::int = 1 limit 1) as "viewsGained",
       (payload #>> '{viewsPerMinute,now}')::float8 as "perMinNow", (payload #>> '{viewsPerMinute,before}')::float8 as "perMinBefore"
  from public.story_view where story_id = any($1::text[]) and payload #>> '{provenance,kind}' = 'observed'`;

/** One pass of both checks. Returns how many alerts were queued. */
export async function checkStarred(db: Db, P: NotifyPolicy, nowMs: number): Promise<number> {
  const watches = await db.query<{ userId: string; storyId: string }>('select user_id as "userId", story_id as "storyId" from people.watch');
  const byStory = new Map<string, string[]>();
  for (const w of watches) byStory.set(w.storyId, [...(byStory.get(w.storyId) ?? []), w.userId]);
  const stories = [...byStory.keys()];
  const marks = new Set((await db.query<{ stream: string; key: string }>(`select stream, key from people.pipeline_seen where stream = any($1::text[]) and key = $2`, [[SPEED_STREAM, BIG_ACCOUNT_STREAM], SEEDED])).map((r) => r.stream));
  let queued = 0;

  /* Speed: one level per gapMs window, so a fast narrative is queued once a window. */
  if (!marks.has(SPEED_STREAM)) {
    await db.query('insert into people.pipeline_seen (stream, key) values ($1, $2) on conflict do nothing', [SPEED_STREAM, SEEDED]);
  } else if (stories.length > 0) {
    const pages = (await db.query<Record<string, unknown>>(PAGES_SQL, [stories])).map((r): StarredPage => ({
      storyId: String(r['storyId']), title: String(r['title'] ?? ''), dead: r['dead'] === true, newPosts: num(r['newPosts']), viewsGained: num(r['viewsGained']), perMinNow: num(r['perMinNow']), perMinBefore: num(r['perMinBefore']),
    }));
    const window = Math.floor(nowMs / P.starredSpeed.gapMs);
    for (const p of pages.filter((x) => takingOff(x, P))) {
      for (const userId of byStory.get(p.storyId) ?? []) {
        const claimed = await db.query('select 1 from people.alert_claim where user_id = $1 and kind = $2 and subject = $3 and rung = $4', [userId, 'starred_speed', p.storyId, window]);
        const waiting = await db.query('select 1 from people.alert_queue where user_id = $1 and kind = $2 and subject = $3 and rung = $4', [userId, 'starred_speed', p.storyId, window]);
        if (claimed.length > 0 || waiting.length > 0) continue;
        await queue(db, { userId, kind: 'starred_speed', subject: p.storyId, rung: window, facts: { title: p.title, newPosts: p.newPosts, viewsGained: p.viewsGained }, href: storyHref(p.storyId) });
        queued += 1;
      }
    }
  }

  /* Big accounts: every member post of a starred narrative by an account over the bar, once per narrative and post. */
  if (stories.length === 0 && marks.has(BIG_ACCOUNT_STREAM)) return queued;
  const big = await db.query<{ storyId: string; itemId: string; handle: string | null; followers: number; body: string | null; postedMs: number | null; title: string }>(
    `select m.narrative_id as "storyId", m.item_id as "itemId", a.handle, a.follower_count::float8 as followers, i.body,
            (extract(epoch from i.posted_at) * 1000)::float8 as "postedMs", coalesce(v.payload ->> 'title', n.title, '') as title
       from internal.narrative_member m
       join internal.narrative n on n.narrative_id = m.narrative_id
       join public.item i on i.item_id = m.item_id
       join public.author a on a.author_key = i.author_key
       left join public.story_view v on v.story_id = m.narrative_id
      where m.narrative_id = any($1::text[]) and a.follower_count >= $2 and i.origin = 'observed'`,
    [stories, P.bigAccount.minFollowers],
  );
  const seen = new Set((await db.query<{ key: string }>('select key from people.pipeline_seen where stream = $1', [BIG_ACCOUNT_STREAM])).map((r) => r.key));
  const fresh = big.filter((b) => !seen.has(`${b.storyId}|${b.itemId}`));
  const remember = async (keys: readonly string[]) => {
    if (keys.length > 0) await db.query('insert into people.pipeline_seen (stream, key) select $1, unnest($2::text[]) on conflict do nothing', [BIG_ACCOUNT_STREAM, [...keys]]);
  };
  if (!seen.has(SEEDED)) {
    await remember([SEEDED, ...fresh.map((b) => `${b.storyId}|${b.itemId}`)]);
    return queued;
  }
  /* Old posts the regroup adds now are remembered, not pushed: a big account's post is news while it is new. */
  const old = fresh.filter((b) => b.postedMs === null || nowMs - b.postedMs > P.bigAccount.maxPostAgeMs);
  const due = fresh.filter((b) => !old.includes(b)).sort((a, z) => (z.postedMs ?? 0) - (a.postedMs ?? 0)).slice(0, P.bigAccount.perPass);
  const pictures = await posterPictures(db, due.map((d) => d.itemId));
  for (const b of due) {
    for (const userId of byStory.get(b.storyId) ?? []) {
      const picture = pictures.get(b.itemId);
      await queue(db, {
        userId,
        kind: 'starred_big_account',
        subject: `${b.storyId}|${b.itemId}`,
        rung: 0,
        facts: { title: b.title, author: b.handle === null ? null : `@${b.handle}`, followers: Number(b.followers), excerpt: b.body ?? '', ...(picture === undefined ? {} : { picture }) },
        href: storyHref(b.storyId),
      });
      queued += 1;
    }
  }
  await remember([...old, ...due].map((b) => `${b.storyId}|${b.itemId}`));
  return queued;
}
