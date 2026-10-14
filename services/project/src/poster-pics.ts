/**
 * THE POSTER-PICTURE COPIER: which posters on a feed still need their profile picture copied into
 * our storage, the file name each copy gets, and what the account row records about the try.
 *
 * ★ WHY COPY AT ALL. The short-video source signs its picture links and they stop loading about a
 * day after the read (`x-expires`, measured 2026-10-14: 24 hours ahead). Every card older than
 * that — the whole infinite scroll below the frame — lost its poster's face, on every phone, and
 * the account is re-read only when the source happens to return one of its posts again. A copy in
 * the public bucket does not expire. The text source's links do not expire, but its posters are
 * copied too: one rule, one place the app looks first, and a renamed or replaced picture there
 * stops 404ing on old cards.
 *
 * Which posters: every account with a post on For You or Popular now (public.rising_row) or still
 * on their infinite scroll (public.feed_post), whose link is not the one last taken up
 * (`picture_copy_of`, 0079). A link is fetched once: copied, or refused with the reason logged —
 * not a picture (an HEIC file the browsers cannot draw), over the cap, expired, a host that
 * failed. A refused link is tried again only when a newer read of the account brings a new one.
 *
 * ★ THE FILE NAME IS THE ACCOUNT AND THE PICTURE'S OWN PATH, HASHED. The query string is the
 * signature and changes on every read, so it is left out: re-reading an account with the same
 * picture finds the name it already has and copies nothing. A new picture is a new path, so a new
 * name, and no phone keeps showing the old face from its cache.
 *
 * Run from logos-main.ts, the coin-logo job, after the logos: it needs the same storage key and the
 * same schedule, and a slow picture host here costs one pass of faces, never a frame of the board.
 * Separate from coin-logos.ts because a coin's picture has three sources and a retry ledger, and a
 * poster's has one link and no retry of its own.
 *
 * What breaks if changed carelessly: the name. The app builds `author-pics/<picture_copy>`, so the
 * name must stay 32 hex characters (adapters/storage/supabase/src/poster-pic.ts refuses anything
 * else). And the pass budget: it shares the logo job's two-minute slot.
 */

import { createHash } from 'node:crypto';

import type { Db } from '@insidor/store';

/** Posters looked at per pass; the feeds hold a few hundred, so the first passes after a deploy clear them. */
export const POSTERS_PER_PASS = 120;
/** Pictures fetched at once. */
export const POSTER_CONCURRENCY = 8;
/** No new picture is started after this much of the pass. */
export const POSTER_BUDGET_MS = 30_000;
/** The largest picture copied. A 300px profile picture is 10 to 40 kB. */
export const MAX_POSTER_BYTES = 512 * 1024;

/** Whether migration 0079 has run; before it there is nowhere to record a copy. */
export const POSTER_MIGRATED_SQL = `
select 1 from information_schema.columns where table_schema = 'public' and table_name = 'author' and column_name = 'picture_copy_of'`;

/** The posters on a feed whose link has not been taken up. `$1` limit. */
export const DUE_POSTERS_SQL = `
with shown as (
  select item_id from public.rising_row
  union
  select item_id from public.feed_post where withdrawn_at is null
)
select distinct a.author_key, a.picture_url, a.picture_copy
  from shown s
  join public.item i on i.item_id = s.item_id
  join public.author a on a.author_key = i.author_key
 where a.picture_url like 'https://%'
   and a.picture_url is distinct from a.picture_copy_of
 limit $1`;

/** `$1` key, `$2` the link taken up, `$3` the copy's name, or null to keep the copy there is. */
export const RECORD_POSTER_SQL = `
update public.author
   set picture_copy_of = $2,
       picture_copy = coalesce($3, picture_copy)
 where author_key = $1`;

/** The copy's name for this account and this picture: 32 hex characters. */
export function posterFile(authorKey: string, link: string): string {
  const path = link.split(/[?#]/, 1)[0] ?? link;
  return createHash('sha256').update(`${authorKey}\n${path}`).digest('hex').slice(0, 32);
}

export interface PosterDeps {
  readonly db: Db;
  readonly elapsedMs: () => number;
  /** Fetch the link and store it under the name; throws with the reason when it cannot. */
  readonly copy: (file: string, link: string) => Promise<void>;
  readonly log: (msg: string, fields: Record<string, unknown>) => void;
}

export interface PosterResult {
  readonly copied: number;
  /** Same picture as the copy already stored: recorded, nothing fetched. */
  readonly same: number;
  readonly refused: number;
  readonly skippedForTime: number;
}

export async function posterPass(deps: PosterDeps): Promise<PosterResult> {
  const result = { copied: 0, same: 0, refused: 0, skippedForTime: 0 };
  if ((await deps.db.query(POSTER_MIGRATED_SQL, [])).length === 0) {
    deps.log('poster pictures wait for migration 0079', {});
    return result;
  }
  const due = await deps.db.query<{ author_key: string; picture_url: string; picture_copy: string | null }>(DUE_POSTERS_SQL, [POSTERS_PER_PASS]);
  let done = 0;
  for (let i = 0; i < due.length; i += POSTER_CONCURRENCY) {
    if (deps.elapsedMs() > POSTER_BUDGET_MS) break;
    await Promise.all(
      due.slice(i, i + POSTER_CONCURRENCY).map(async (row) => {
        const file = posterFile(row.author_key, row.picture_url);
        let stored: string | null = null;
        if (file === row.picture_copy) {
          result.same += 1;
        } else {
          try {
            await deps.copy(file, row.picture_url);
            stored = file;
            result.copied += 1;
          } catch (e) {
            result.refused += 1;
            deps.log('poster picture not copied', { author: row.author_key, why: e instanceof Error ? e.message : String(e) });
          }
        }
        await deps.db.query(RECORD_POSTER_SQL, [row.author_key, row.picture_url, stored]);
        done += 1;
      }),
    );
  }
  result.skippedForTime = due.length - done;
  return result;
}
