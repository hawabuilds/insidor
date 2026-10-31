/**
 * THE POSTS A NEW READING JUST PUT OVER FOR YOU'S VIEWS BAR (Policy.rising.quickFrame.barCross).
 *
 * A post the judge passed but that had too few views waited, until now, for a full frame to notice its
 * views had grown: the quick frame weighed only a new answer, a coin's link or the owner's call. Measured
 * over the 48 h to 30 Oct: of 819 For You posts with a yes, 80 crossed the bar after it and showed 6.5 min
 * after that reading at the median; the 739 over it at the yes showed 0.4 min after the yes. This file
 * names those posts so the quick frame places them in seconds, and so a full frame that began before
 * the reading leaves them as the quick frame placed them (for-you-lock.ts rule 2).
 *
 * Its own file because for-you-lock.ts (which both frames import) cannot import rising.ts, which owns
 * the bar: the bar arrives as a function (rising.ts `clearsForYouBar`), never as a second copy of it.
 *
 * ★ CROSSED, NOT CLEARED. A post counts only when its readings now clear the bar and the readings taken
 * up to the cursor did not. A post over the bar for an hour and kept off For You by something else (a
 * held kind, the variety rule, the score bar) is not re-weighed on each of its readings: it crosses once,
 * and the frame after that is past it. That is what keeps this from running the quick frame every few
 * seconds, which is why the quick frame's header once left readings to the full frame.
 *
 * ★ A SMALL, INDEX-ONLY READ. It starts from the judge's answers of For You's window (post_judgement by
 * judged_at, a few thousand rows), keeps the posts whose newest main answer is yes with no held kind
 * after it, that are not on For You and not withdrawn, and asks the readings table one primary-key probe
 * each for a reading past the cursor. Only the few posts that pass that have their readings loaded, and
 * at most `maxPosts` of them. Nothing here sweeps the readings table by time.
 *
 * What breaks if changed carelessly: the "not before the cursor" half. Dropped, every judged post over
 * the bar and off For You would wake a quick frame on each reading — the probe asks every five seconds.
 */

import type { Millis } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { Db } from '@insidor/store';

import { loadReach } from './db.ts';
import type { ReachReading } from './project.ts';

/** For You's views bar for one post (rising.ts `clearsForYouBar`, with the policy bound). */
export type ClearsForYouBar = (readings: readonly ReachReading[], postedAtMs: number | null, source: string) => boolean;

/** The bar, and the policy whose window and cap the read keeps to. */
export interface BarCheck {
  readonly clears: ClearsForYouBar;
  readonly policy: Policy;
}

/** Whether `readings` clear the bar now and the ones taken at or before `sinceMs` did not: a crossing past the cursor. */
export function crossedSince(readings: readonly ReachReading[], sinceMs: number, postedAtMs: number | null, source: string, clears: ClearsForYouBar): boolean {
  if (!clears(readings, postedAtMs, source)) return false;
  return !clears(readings.filter((x) => x.atMs <= sinceMs), postedAtMs, source);
}

/**
 * The posts the judge passed, inside For You's window, not on it and not withdrawn, whose readings past
 * `sinceMs` (the cursor's database time) put them over For You's views bar. Empty when switched off.
 */
export async function barCrossers(db: Db, sinceMs: number, check: BarCheck): Promise<readonly string[]> {
  const q = check.policy.rising.quickFrame.barCross;
  if (!q.on || q.maxPosts <= 0) return [];
  const rows = await db.query<{ item_id: string; source: string; posted_at: Date | string | null }>(
    `select y.item_id, i.source, i.posted_at
       from (select distinct on (item_id) item_id, id, coinable
               from internal.post_judgement
              where judged_at > now() - $1 * interval '1 millisecond' and prompt_id not like 'post-kind%'
              order by item_id, id desc) y
       join public.item i on i.item_id = y.item_id
      where y.coinable
        and coalesce(i.posted_at, i.first_seen_at) > now() - $1 * interval '1 millisecond'
        and not exists (select 1 from internal.post_judgement k where k.item_id = y.item_id and k.prompt_id like 'post-kind%' and k.id > y.id)
        and not exists (select 1 from public.rising_row r where r.feed_id = 'fyp' and r.item_id = y.item_id)
        and not exists (select 1 from public.feed_post f where f.feed_id = 'fyp' and f.item_id = y.item_id and f.withdrawn_at is not null)
        and exists (select 1 from public.observation o where o.item_id = y.item_id and o.kind = 'reach' and o.captured_at > $2)
      limit $3`,
    [check.policy.rising.windowMs, new Date(sinceMs).toISOString(), q.maxPosts],
  );
  if (rows.length === 0) return [];
  const reach = await loadReach(db, rows.map((r) => r.item_id), (sinceMs - check.policy.rising.windowMs) as Millis);
  return rows.flatMap((r) => {
    const postedAtMs = r.posted_at === null ? null : new Date(r.posted_at).getTime();
    return crossedSince(reach.get(r.item_id) ?? [], sinceMs, postedAtMs, r.source, check.clears) ? [r.item_id] : [];
  });
}
