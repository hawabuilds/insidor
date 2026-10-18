/**
 * "SEEN AND KEPT": THE OWNER'S SOFT YES, READ FROM WHAT WAS ON HIS SCREEN (internal.owner_seen,
 * 0098) AND HIS CALLS (internal.owner_feedback, gold, his missed list).
 *
 * The owner, 2026-10-18: "Counts as good: a post that was on my screen for at least 2 seconds, or
 * that I opened, and that I didn't tap Not a meme on within 24 hours. ... these count as softer yes
 * labels than a gold or missed post I sent you ... my explicit labels win if they disagree."
 *
 * One outcome per post the owner saw, `seenOutcome`, in this order:
 *   not      his current post call is "Not a meme" — whenever he tapped it, inside the window or after
 *   meme     his current call is "meme", or a gold sheet or his missed list holds it: an explicit yes
 *   waiting  first seen less than `keepWindowMs` ago: he may still tap it, so it is no label yet
 *   kept     seen (on screen for the app's two seconds, or opened), no "Not a meme", the window closed
 *
 * Its own file because three readers use it — the 20:00 table's memeable share and its daily
 * seen-and-kept count (tools/lib/scorecard.ts), the judge's re-tune examples (eval examples.ts
 * `keptYes`) and the coin model's fit (tools/lib/coin-model.ts) — and all three must agree on which
 * posts are kept. Derived at read time, never stored, so a late "Not a meme" undoes a keep at once.
 *
 * ★ BEFORE 0098 THERE ARE NO ROWS, NOT AN ERROR: a missing table reads as nothing seen, so a tool or
 * the re-tune deployed first runs exactly as before.
 *
 * What breaks if changed carelessly: the order. Testing the window before the owner's calls would
 * report a post he tapped "Not a meme" an hour ago as "waiting", and one he called a meme as soft.
 */

import type { Db } from '../client.ts';

export type SeenOutcome = 'kept' | 'not' | 'meme' | 'waiting';

export interface SeenFacts {
  readonly firstSeenAtMs: number;
  /** The owner's current post call: the newest of "meme" and "not"; null when none. */
  readonly call: 'meme' | 'not' | null;
  /** A gold sheet or the owner's missed list holds the post. */
  readonly listed: boolean;
}

export interface SeenRow extends SeenFacts {
  readonly itemId: string;
  readonly onScreen: boolean;
  readonly opened: boolean;
  /** The owner tapped "Not a meme" inside the window after the first sight. */
  readonly notInWindow: boolean;
  readonly outcome: SeenOutcome;
}

/** The outcome by the header's order: the owner's explicit calls first, then the window. */
export function seenOutcome(f: SeenFacts, keepWindowMs: number, nowMs: number): SeenOutcome {
  if (f.call === 'not') return 'not';
  if (f.call === 'meme' || f.listed) return 'meme';
  if (nowMs < f.firstSeenAtMs + keepWindowMs) return 'waiting';
  return 'kept';
}

const missing = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '42P01';

export class PgOwnerSeenRepo {
  readonly #db: Db;
  constructor(db: Db) {
    this.#db = db;
  }

  /** Every post the owner first saw in [since, until), with its outcome as of `now`. */
  async seen(q: { readonly since: Date; readonly until: Date; readonly keepWindowMs: number; readonly now: Date }): Promise<readonly SeenRow[]> {
    type R = { item_id: string; first_at: Date; on_screen: boolean; opened: boolean; call: 'meme' | 'not' | null; listed: boolean; not_in_window: boolean };
    let rows: readonly R[];
    try {
      rows = await this.#db.query<R>(
        `with s as (
           select item_id, min(least(first_seen_on_screen_at, opened_at)) as first_at,
                  bool_or(first_seen_on_screen_at is not null) as on_screen, bool_or(opened_at is not null) as opened
             from internal.owner_seen group by item_id
         )
         select s.item_id, s.first_at, s.on_screen, s.opened,
                (select o.verdict from internal.owner_feedback o
                  where o.subject_kind = 'post' and o.item_id = s.item_id and o.verdict in ('meme', 'not')
                  order by o.created_at desc, o.id desc limit 1) as call,
                (exists (select 1 from internal.gold_addition g where g.item_id = s.item_id)
                 or exists (select 1 from internal.missed_post m where m.item_id = s.item_id)) as listed,
                exists (select 1 from internal.owner_feedback o
                         where o.subject_kind = 'post' and o.item_id = s.item_id and o.verdict = 'not'
                           and o.created_at >= s.first_at and o.created_at < s.first_at + $3::float8 * interval '1 millisecond') as not_in_window
           from s
          where s.first_at >= $1 and s.first_at < $2`,
        [q.since, q.until, q.keepWindowMs],
      );
    } catch (e) {
      if (missing(e)) return [];
      throw e;
    }
    return rows.map((r) => {
      const facts: SeenFacts = { firstSeenAtMs: new Date(r.first_at).getTime(), call: r.call, listed: r.listed };
      return { itemId: r.item_id, ...facts, onScreen: r.on_screen, opened: r.opened, notInWindow: r.not_in_window, outcome: seenOutcome(facts, q.keepWindowMs, q.now.getTime()) };
    });
  }

  /** The ids of every kept post first seen in [since, until): the soft yes labels. */
  async keptIds(q: { readonly since: Date; readonly until: Date; readonly keepWindowMs: number; readonly now: Date }): Promise<ReadonlyMap<string, number>> {
    return new Map((await this.seen(q)).filter((r) => r.outcome === 'kept').map((r) => [r.itemId, r.firstSeenAtMs] as const));
  }
}
