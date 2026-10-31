/**
 * WHO MAY WRITE FOR YOU, AND WHAT A FRAME THAT BEGAN EARLIER MUST LEAVE ALONE.
 *
 * The full frame (main.ts, every minute, two minutes of work) and the quick frame (quick-main.ts,
 * seconds after a judge's answer) run side by side in the project service: the quick one no longer
 * waits for the full one to finish (tools/railway-start.mjs). Both write For You — its rows, its
 * tick, its cards' coin lists and feed membership — so this file holds the two rules that keep them
 * from undoing each other. Its own file because both frames import it and rising.ts must not import
 * the quick frame (which imports rising.ts).
 *
 *   1. ONE WRITER AT A TIME. Each frame takes `lockForYou` — a transaction advisory lock, released
 *      at its commit or rollback, so it holds on the transaction pooler — after it has built its
 *      cards and before it reads For You as committed. The quick frame then reads the full frame's
 *      committed list, or the full frame reads the quick frame's: never a half of each, and never
 *      two frames writing the same tick.
 *   2. A NEWER ANSWER WINS. The full frame read its posts when it began, up to two minutes before it
 *      writes. Every post that changed since it began (`changedPosts` past `frameCursor`: a new
 *      answer, a coin's new link to a passed post, the owner's call, a reading that put a passed post
 *      over For You's views bar — bar-cross.ts) is the quick frame's to place,
 *      so the full frame keeps those posts as For You shows them now — on it or off it — instead of
 *      writing its older verdict over a card the quick frame put up a minute ago.
 *
 * What breaks if changed carelessly: taking the lock before the slow part. Either frame holding it
 * while it builds would make the other wait out that build, which is the minute this exists to save;
 * taking it after reading For You would write over a commit made in between.
 */

import type { Db } from '@insidor/store';

import { barCrossers, type BarCheck } from './bar-cross.ts';

/** The advisory lock key both frames take before they read and write For You: "FYP" in ASCII. Any fixed key would do; it only has to be the same in both. */
export const FOR_YOU_LOCK = 0x465950;

/** The most changed posts one frame weighs or defers; past it the next full frame has them. */
const MAX_CHANGED = 300;

/** Where a frame began: the newest answer's id, and the database's clock. */
export interface QuickCursor {
  readonly answerId: number;
  readonly atMs: number;
}

const ms = (v: Date | string | null | undefined): number | null => (v === null || v === undefined ? null : new Date(v).getTime());

/** Wait for, then hold until this transaction ends, the one right to write For You. */
export async function lockForYou(db: Db): Promise<void> {
  await db.query(`select pg_advisory_xact_lock($1)`, [FOR_YOU_LOCK]);
}

/** Where a frame begins: read before it reads any post, so anything filed after is past it. */
export async function frameCursor(db: Db): Promise<QuickCursor> {
  const rows = await db.query<{ answer_id: string | null; now: Date | string }>(
    `select (select id::text from internal.post_judgement order by id desc limit 1) as answer_id, now() as now`,
  );
  const r = rows[0];
  return { answerId: r?.answer_id === null || r?.answer_id === undefined ? 0 : Number(r.answer_id), atMs: ms(r?.now) ?? 0 };
}

/**
 * The coin-first route's posts whose coin was picked after the cursor's time (0113, 0116): the pick is
 * what lets such a post in (coin-first.ts). Empty before 0116.
 */
export async function pickedCoinFirst(db: Db, cursor: QuickCursor): Promise<readonly string[]> {
  /* Looked up first: a failed statement would abort the frame's transaction. */
  const present = await db.query<{ t: string | null }>(`select to_regclass('internal.coin_first_post')::text as t`);
  if ((present[0]?.t ?? null) === null) return [];
  const rows = await db.query<{ item_id: string }>(
    `select p.item_id from internal.post_coin_pick p
       join internal.coin_first_post c on c.item_id = p.item_id
      where p.outcome = 'picked' and p.decided_at > $1
      limit $2`,
    [new Date(cursor.atMs).toISOString(), MAX_CHANGED],
  );
  return rows.map((r) => r.item_id);
}

/**
 * The posts that changed past the cursor: every post with an answer filed after its answer id, every post
 * the judge passed that a coin linked, or the owner called, after its time, every coin-first post picked
 * since, and — given For You's bar — every passed post a reading since put over that bar (bar-cross.ts).
 * Both frames pass the bar, so the full frame defers to the quick frame on exactly the posts it places.
 */
export async function changedPosts(db: Db, cursor: QuickCursor, bar: BarCheck | null = null): Promise<readonly string[]> {
  const rows = await db.query<{ item_id: string }>(
    `(select distinct item_id from internal.post_judgement where id > $1 order by item_id limit $3)
     union
     (select l.source || ':' || l.source_item_id as item_id
        from internal.coin_post_link l
       where l.found_at > $2
         and exists (select 1 from internal.post_judgement j
                      where j.item_id = l.source || ':' || l.source_item_id
                        and j.prompt_id not like 'post-kind%' and j.coinable)
       limit $3)
     union
     (select o.item_id from internal.owner_feedback o
       where o.subject_kind = 'post' and o.created_at > $2 and o.item_id is not null
       limit $3)`,
    [cursor.answerId, new Date(cursor.atMs).toISOString(), MAX_CHANGED],
  );
  const picked = await pickedCoinFirst(db, cursor);
  const crossed = bar === null ? [] : await barCrossers(db, cursor.atMs, bar);
  return [...new Set([...rows.map((r) => r.item_id), ...picked, ...crossed])];
}
