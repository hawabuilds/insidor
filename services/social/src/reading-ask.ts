/**
 * POST /post/:id/reading — the phone's post sheet was opened; ask the runner for a fresh view
 * reading of that post (internal.reading_ask, 0090; the runner's readings loop answers it).
 *
 * Its own file because it is the one route here that is about a post's numbers rather than people,
 * and it is open to anyone: the sheet is, so a signed-out viewer's open counts the same.
 *
 * ★ IT ASKS, IT NEVER READS. This service holds no source keys and spends nothing. Whether a read is
 * taken — the post's newest reading over a minute old, the readings lane's daily cap, the pass's
 * cap on opened posts — is the runner's decision (services/runner/src/work/readings.ts). So the
 * reply says only whether the ask was recorded, never that a reading is coming.
 *
 * ★ RATE-LIMITED PER POST BY THE ROW, AND PER CLIENT BY THE SERVICE'S PACER. One row per post: a
 * second open within `openReadMinGapMs` of the last recorded one changes nothing, so a crowd on one
 * post is one read. Only a post a feed holds is recorded, so ids nobody shows cannot fill the table.
 *
 * What breaks if changed carelessly: moving `asked_at` on every open would let a stream of opens
 * keep a row young for ever; the runner would still answer it, but the per-post limit would be gone.
 */

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { json, type Reply } from './http.ts';

/** The one query this needs; the routes' own Db satisfies it (declared here, not imported, so the two files do not import each other). */
interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R[]>;
}

/** An item id as the feeds name posts: a source, a colon, the source's own id. */
const ITEM_ID = /^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9_.-]{1,128}$/;

export async function askForReading(db: Db, itemId: string, now: number, minGapMs = DEFAULT_POLICY.feed.readings.openReadMinGapMs): Promise<Reply> {
  if (!ITEM_ID.test(itemId)) return json(400, { error: 'bad post id' });
  const rows = await db.query<{ item_id: string }>(
    `insert into internal.reading_ask (item_id, asked_at)
     select $1, $2
      where exists (select 1 from public.rising_row r where r.item_id = $1)
         or exists (select 1 from public.feed_post f where f.item_id = $1)
     on conflict (item_id) do update set asked_at = excluded.asked_at
      where internal.reading_ask.asked_at <= excluded.asked_at - make_interval(secs => $3::double precision / 1000)
     returning item_id`,
    [itemId, new Date(now), minGapMs],
  );
  if (rows.length > 0) return json(202, { asked: true });
  /* Nothing written: the post is on no feed, or it was asked about within the gap. Which one is
     not worth a second query; the phone does nothing different either way. */
  return json(202, { asked: false });
}
