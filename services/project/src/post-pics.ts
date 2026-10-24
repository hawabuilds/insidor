/**
 * THE POST-PICTURE COPIER: which shown posts' pictures still need a copy in our storage, the file
 * name each copy gets, and what public.post_picture (0119) records about the try.
 *
 * ★ WHY COPY AT ALL. The short-video source signs its cover links (`x-expires`, about a day), so a
 * card older than that showed the placeholder: on 2026-10-21, 297 of the 311 TikTok posts on For
 * You, Popular and the scroll. A copy in the public bucket does not expire. The text source's
 * links do not expire, but a deleted post's picture does go, and one rule keeps one place the app
 * looks first.
 *
 * Which pictures: every picture a card shows — For You and Popular now (public.rising_row), the
 * scroll (public.feed_post), a quoted post's inside either card, and every narrative's own picture
 * and its posts' (public.story_view)
 * — read from the projected payloads, the links the app is handed. Copied soon after they first
 * appear, while the link still loads: a link already expired when first seen is recorded as such
 * and not fetched, and taken up again only when a newer read brings a link that loads.
 *
 * ★ THE ORDER IS WHAT EXPIRES FIRST. For You and Popular before the scroll, the scroll before the
 * narratives; within each, the link that expires soonest first, and links that do not expire
 * last. So the per-day cap, when the backfill reaches it, holds back pictures that can wait.
 *
 * ★ ONE ROW PER PICTURE, BY THE LINK'S PATH. The query string is the signature and changes on
 * every read, so it is left out: a re-read of the same picture finds the copy it already has, and
 * a picture two posts share is copied once. The file name is the path, hashed: a new picture is a
 * new path, so a new name, and no phone keeps showing an old picture from its cache.
 *
 * Run from logos-main.ts, the coin-logo job, after the faces: it needs the same storage key and the
 * same schedule, and a slow picture host here costs one pass of pictures, never a frame of the
 * board. Separate from poster-pics.ts because a post picture has two sizes, a per-day cap and a
 * retry, and a face has none.
 *
 * What breaks if changed carelessly: the name (the app builds `post-pics/<file>`, so it must stay
 * 32 hex characters) and the path rule, which the read service repeats (services/read
 * post-pics.ts `linkPath`): if the two cut a link differently, every copy is stored and none found.
 */

import { createHash } from 'node:crypto';

import type { PostPicturePolicy } from '@insidor/contracts/policy.ts';
import type { Db } from '@insidor/store';

/** Whether migration 0119 has run; before it there is nowhere to record a copy. */
export const POST_PICS_MIGRATED_SQL = `select to_regclass('public.post_picture') is not null as ok`;

/** Every picture link a card shows, once, with its most urgent surface: 0 For You and Popular, 1 the scroll, 2 the narratives. */
const SHOWN_LINKS = `
with shown as (
  select r.payload ->> 'thumbUrl' as link, 0 as surface from public.rising_row r
  union all
  select f.payload ->> 'thumbUrl', 1 from public.feed_post f where f.withdrawn_at is null
  union all
  select r.payload -> 'quote' ->> 'thumbUrl', 0 from public.rising_row r
  union all
  select f.payload -> 'quote' ->> 'thumbUrl', 1 from public.feed_post f where f.withdrawn_at is null
  union all
  select v.payload ->> 'thumbUrl', 2 from public.story_view v
  union all
  select e ->> 'thumbUrl', 2
    from public.story_view v
   cross join lateral jsonb_array_elements(case when jsonb_typeof(v.payload -> 'evidence') = 'array' then v.payload -> 'evidence' else '[]'::jsonb end) e
), links as (
  select link, min(surface) as surface from shown where link like 'https://%' group by link
)`;

/** The shown links whose picture holds no copy yet, with the record of the last try when there is one. */
export const SHOWN_PICTURES_SQL = `${SHOWN_LINKS}
select l.link, l.surface, p.tried_link, p.tried_at
  from links l
  left join public.post_picture p on p.link_path = split_part(split_part(l.link, '#', 1), '?', 1)
 where p.file is null`;

/** The same before 0119 (the dry run against a database the migration has not reached): nothing tried, nothing copied. */
export const SHOWN_PICTURES_BEFORE_0119_SQL = `${SHOWN_LINKS}
select l.link, l.surface, null::text as tried_link, null::timestamptz as tried_at from links l`;

/** Copies written in the last 24 hours: the per-day cap counts these. */
export const COPIED_TODAY_SQL = `select count(*)::int as n from public.post_picture where copied_at > now() - interval '24 hours'`;

/** `$1` path, `$2` the copy's name or null, `$3` the link taken up. A refusal keeps a copy there is. */
export const RECORD_PICTURE_SQL = `
insert into public.post_picture as p (link_path, file, tried_link, tried_at, copied_at)
values ($1, $2, $3, now(), case when $2::text is null then null else now() end)
on conflict (link_path) do update
   set file = coalesce(excluded.file, p.file),
       tried_link = excluded.tried_link,
       tried_at = excluded.tried_at,
       copied_at = coalesce(excluded.copied_at, p.copied_at)`;

/** `$1` paths, `$2` their links: pictures already expired when first seen, recorded once, never fetched. */
export const RECORD_EXPIRED_SQL = `
insert into public.post_picture (link_path, file, tried_link)
select path, null, link from unnest($1::text[], $2::text[]) as t(path, link)
on conflict (link_path) do nothing`;

/** A link that expires within this long is treated as expired: the fetch would race it. */
const EXPIRY_MARGIN_MS = 60_000;

/** The link without its signature: the same picture under any read. Repeated in services/read post-pics.ts. */
export function linkPath(link: string): string {
  return link.split(/[?#]/, 1)[0] ?? link;
}

/** The copy's name for this picture: 32 hex characters. */
export function postPicFile(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 32);
}

/** When a signed link stops loading, from its `x-expires` (seconds); null for a link that does not say. */
export function expiresAtMs(link: string): number | null {
  const m = /[?&]x-expires=(\d{1,12})(?:&|#|$)/.exec(link);
  return m === null ? null : Number(m[1]) * 1000;
}

export interface ShownRow {
  readonly link: string;
  readonly surface: number;
  readonly tried_link: string | null;
  readonly tried_at: Date | string | null;
}

export interface DuePicture {
  readonly path: string;
  readonly link: string;
  readonly file: string;
  readonly surface: number;
  readonly expiresAtMs: number | null;
}

export interface PicturePlan {
  /** Pictures to fetch, in order, before any cap. */
  readonly due: readonly DuePicture[];
  /** Pictures seen for the first time with every link already expired: recorded, not fetched. */
  readonly expired: readonly { readonly path: string; readonly link: string }[];
  /** Pictures refused before whose link has not changed and whose retry is not due: left alone. */
  readonly waiting: number;
}

/**
 * Which pictures to copy now. Pure: the rows, the clock and the retry wait in, the plan out. Of a
 * picture's several links (one per projected payload), the one that loads longest is taken.
 */
export function planPictures(rows: readonly ShownRow[], nowMs: number, retryAfterMs: number): PicturePlan {
  const byPath = new Map<string, { link: string; surface: number; expires: number | null; tried: string | null; triedAt: number | null }>();
  const later = (e: number | null) => e ?? Number.POSITIVE_INFINITY;
  for (const r of rows) {
    if (!r.link.startsWith('https://')) continue;
    const path = linkPath(r.link);
    const expires = expiresAtMs(r.link);
    const triedAt = r.tried_at === null ? null : new Date(r.tried_at).getTime();
    const had = byPath.get(path);
    if (had === undefined) {
      byPath.set(path, { link: r.link, surface: r.surface, expires, tried: r.tried_link, triedAt });
      continue;
    }
    had.surface = Math.min(had.surface, r.surface);
    if (later(expires) > later(had.expires)) {
      had.link = r.link;
      had.expires = expires;
    }
  }
  const due: DuePicture[] = [];
  const expired: { path: string; link: string }[] = [];
  let waiting = 0;
  for (const [path, p] of byPath) {
    const loads = p.expires === null || p.expires > nowMs + EXPIRY_MARGIN_MS;
    if (p.tried === null) {
      if (loads) due.push({ path, link: p.link, file: postPicFile(path), surface: p.surface, expiresAtMs: p.expires });
      else expired.push({ path, link: p.link });
      continue;
    }
    const retry = p.link !== p.tried || p.triedAt === null || nowMs - p.triedAt >= retryAfterMs;
    if (loads && retry) due.push({ path, link: p.link, file: postPicFile(path), surface: p.surface, expiresAtMs: p.expires });
    else waiting += 1;
  }
  due.sort((a, b) => a.surface - b.surface || later(a.expiresAtMs) - later(b.expiresAtMs) || a.path.localeCompare(b.path));
  return { due, expired, waiting };
}

export interface PostPicDeps {
  readonly db: Db;
  readonly policy: PostPicturePolicy;
  readonly nowMs: number;
  readonly elapsedMs: () => number;
  /** Fetch the link, make both sizes and store them under the name; throws with the reason when it cannot. */
  readonly copy: (file: string, link: string) => Promise<void>;
  readonly log: (msg: string, fields: Record<string, unknown>) => void;
}

export interface PostPicResult {
  readonly copied: number;
  readonly refused: number;
  /** Expired before they were reached: recorded, never fetched. */
  readonly expired: number;
  /** Still due after this pass: the per-pass or per-day cap, or the time. */
  readonly left: number;
  /** Copies written in the last 24 hours, this pass's included. */
  readonly today: number;
}

const NOTHING: PostPicResult = { copied: 0, refused: 0, expired: 0, left: 0, today: 0 };

export async function postPicPass(deps: PostPicDeps): Promise<PostPicResult> {
  const { policy } = deps;
  if (!policy.on) return NOTHING;
  const [ready] = await deps.db.query<{ ok: boolean }>(POST_PICS_MIGRATED_SQL, []);
  if (ready?.ok !== true) {
    deps.log('post pictures wait for migration 0119', {});
    return NOTHING;
  }
  const [rows, [counted]] = await Promise.all([deps.db.query<ShownRow>(SHOWN_PICTURES_SQL, []), deps.db.query<{ n: number }>(COPIED_TODAY_SQL, [])]);
  const plan = planPictures(rows, deps.nowMs, policy.retryAfterMs);
  if (plan.expired.length > 0) await deps.db.query(RECORD_EXPIRED_SQL, [plan.expired.map((e) => e.path), plan.expired.map((e) => e.link)]);
  const before = counted?.n ?? 0;
  const take = plan.due.slice(0, Math.max(0, Math.min(policy.perPass, policy.perDay - before)));
  const result = { copied: 0, refused: 0, expired: plan.expired.length, left: 0, today: before };
  let done = 0;
  for (let i = 0; i < take.length; i += policy.concurrency) {
    if (deps.elapsedMs() > policy.budgetMs) break;
    await Promise.all(
      take.slice(i, i + policy.concurrency).map(async (p) => {
        let stored: string | null = null;
        try {
          await deps.copy(p.file, p.link);
          stored = p.file;
          result.copied += 1;
        } catch (e) {
          result.refused += 1;
          deps.log('post picture not copied', { why: e instanceof Error ? e.message : String(e) });
        }
        await deps.db.query(RECORD_PICTURE_SQL, [p.path, stored, p.link]);
        done += 1;
      }),
    );
  }
  result.left = plan.due.length - done;
  result.today = before + result.copied;
  return result;
}
