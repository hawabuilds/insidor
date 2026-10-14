/**
 * WHO IS ON FOR YOU AND POPULAR FOR GOOD (0075 public.feed_post): the list the phone's infinite
 * scroll reads, kept by the projector beside the frame it writes.
 *
 * ★ THE RULES (the owner, 2026-10-14: "FYP shows every post that ever made it"):
 *   - A post JOINS a feed the first time a frame shows it, and `first_shown_at` is that frame's time.
 *     It is the scroll's order and is never rewritten, so a page the phone has read never shifts.
 *   - A member is never taken out by the projector's own rules: not by the six-hour rule (which
 *     only stops a post joining For You late — rising.ts lets a member stay in the frame), not by
 *     the day's window, not by the frame's cap, and not by a later judge's "no" after a prompt
 *     change. The judge changing its mind is the system's reasoning, not a fact about the post;
 *     such a post leaves the live frame (and feed_rejection records why, as before) but stays in
 *     the scroll where the person already saw it.
 *   - The owner's "Not a meme" withdraws it (`withdrawn_at`), on every feed, at the next run; the
 *     owner calling it a meme again brings it back at its old place.
 *
 * ★ EACH MEMBER'S CARD IS KEPT CURRENT WHILE IT CAN BE. A member in this run's frame or day window
 * gets this run's card; older members are re-projected a few at a time, longest-untried first
 * (`REFRESH_PER_RUN`), so every card is re-read every few minutes to hours. The card carries when it
 * was projected (`payload_at`), and the read service dashes its coin's market numbers once that is
 * older than the market's freshness bar: a cap from yesterday is never shown as today's.
 *
 * Its own file because rising.ts is "what is on screen now" and this is "everything that ever
 * was". It runs inside the projector's one transaction, so every statement is in a savepoint and a
 * database without 0075 is skipped: the feed still commits. What breaks if changed carelessly:
 * writing `first_shown_at` on conflict would move every member to the top on every frame; dropping
 * the savepoint would let a membership failure abort the whole frame.
 */

import type { Db } from '@insidor/store';

import type { WireRisingPost } from './rising.ts';

/**
 * Old members re-projected per run. One run a minute and about two hundred For You posts a day:
 * forty a run walks a fortnight's members in a little over an hour, and costs the projector one more
 * batch of the reads it already makes for the frame.
 */
export const REFRESH_PER_RUN = 40;

/** What the frame builder needs to know about the members before it builds. */
export interface Membership {
  /** For You's members on the list now: the six-hour rule does not apply to them. */
  readonly fyp: ReadonlySet<string>;
  /** Every member, on either feed: their cards are refreshed when projected. */
  readonly all: ReadonlySet<string>;
  /** Members outside the day's window to re-project this run. */
  readonly refresh: readonly string[];
}

/**
 * `fn` inside a savepoint, so a failure rolls back only its own statements and never the frame;
 * null when it failed. Outside a transaction (a test's bare connection) there is nothing to
 * protect and no savepoint to take, so `fn` runs as it is.
 */
async function guarded<T>(db: Db, name: string, fn: () => Promise<T>): Promise<T | null> {
  let saved = true;
  try {
    await db.query(`savepoint ${name}`);
  } catch {
    saved = false;
  }
  try {
    const out = await fn();
    if (saved) await db.query(`release savepoint ${name}`);
    return out;
  } catch (e) {
    if (saved) await db.query(`rollback to savepoint ${name}`);
    console.warn(`feed members: ${name} failed: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown'}`);
    return null;
  }
}

async function migrated(db: Db): Promise<boolean> {
  const rows = await db.query<{ t: string | null }>(`select to_regclass('public.feed_post')::text as t`);
  return (rows[0]?.t ?? null) !== null;
}

/** The members, or null when 0075 is not applied (the frame is then built exactly as before). */
export async function loadMembership(db: Db, sinceMs: number, refreshPerRun: number = REFRESH_PER_RUN): Promise<Membership | null> {
  if (!(await migrated(db))) return null;
  return guarded(db, 'feed_members_load', async () => {
    const members = await db.query<{ feed_id: string; item_id: string }>(
      `select feed_id, item_id from public.feed_post where withdrawn_at is null`,
    );
    /* Outside the window: inside it, the frame projects every passing post anyway. */
    const refresh = await db.query<{ item_id: string }>(
      `select f.item_id
         from public.feed_post f
         join public.item i on i.item_id = f.item_id
        where f.withdrawn_at is null
          and (f.payload is null or coalesce(i.posted_at, i.first_seen_at) < $1)
        group by f.item_id
        order by min(f.tried_at) asc nulls first
        limit $2`,
      [new Date(sinceMs).toISOString(), refreshPerRun],
    );
    return {
      fyp: new Set(members.filter((m) => m.feed_id === 'fyp').map((m) => m.item_id)),
      all: new Set(members.map((m) => m.item_id)),
      refresh: refresh.map((r) => r.item_id),
    };
  });
}

/**
 * After the frame is written: the posts it shows join (or stay on) their feeds with this run's
 * card; every other member projected this run takes its new card; the members this run tried to
 * refresh are marked tried; and the owner's newest call on each member withdraws or restores it.
 */
export async function writeMembership(
  db: Db,
  nowMs: number,
  shown: { readonly fyp: readonly WireRisingPost[]; readonly popular: readonly WireRisingPost[] },
  projected: readonly WireRisingPost[],
  tried: readonly string[],
): Promise<void> {
  if (!(await migrated(db))) return;
  const now = new Date(nowMs).toISOString();
  await guarded(db, 'feed_members', async () => {
    for (const feed of ['fyp', 'popular'] as const) {
      const posts = shown[feed];
      if (posts.length === 0) continue;
      await db.query(
        `insert into public.feed_post (feed_id, item_id, first_shown_at, last_shown_at, payload, payload_at, tried_at)
         select $1, p.id, $2::timestamptz, $2::timestamptz, p.payload, $2::timestamptz, $2::timestamptz
           from unnest($3::text[], $4::jsonb[]) as p(id, payload)
         on conflict (feed_id, item_id) do update
            set last_shown_at = excluded.last_shown_at, payload = excluded.payload,
                payload_at = excluded.payload_at, tried_at = excluded.tried_at`,
        [feed, now, posts.map((p) => p.id), posts.map((p) => JSON.stringify(p))],
      );
    }
    if (projected.length > 0) {
      await db.query(
        `update public.feed_post f
            set payload = p.payload, payload_at = $1::timestamptz, tried_at = $1::timestamptz
           from unnest($2::text[], $3::jsonb[]) as p(id, payload)
          where f.item_id = p.id and (f.payload_at is null or f.payload_at < $1::timestamptz)`,
        [now, projected.map((p) => p.id), projected.map((p) => JSON.stringify(p))],
      );
    }
    if (tried.length > 0) {
      await db.query(`update public.feed_post set tried_at = $1::timestamptz where item_id = any($2::text[])`, [now, [...tried]]);
    }
    /* The owner's newest call on each member (0054): "not" withdraws it, anything newer restores it. */
    await db.query(
      `update public.feed_post f
          set withdrawn_at = case when o.verdict = 'not' then $1::timestamptz else null end
         from (select distinct on (ofb.item_id) ofb.item_id, ofb.verdict
                 from internal.owner_feedback ofb
                where ofb.subject_kind = 'post'
                  and ofb.item_id in (select item_id from public.feed_post)
                order by ofb.item_id, ofb.created_at desc, ofb.id desc) o
        where o.item_id = f.item_id
          and (f.withdrawn_at is null) = (o.verdict = 'not')`,
      [now],
    );
  });
}
