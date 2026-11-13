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
 * ★ NOT A KEEP WHEN HE WAS NOT LOOKING (the owner, 2026-11-13). Silence is a yes only on a day he
 * was reviewing. `keptIds` drops a post first seen inside a window he named (`notReviewing`) or on a
 * day the guard finds he was not reviewing (`reviewingDays`: far fewer posts seen, or far fewer Not a
 * meme taps, than the days before it). `seen` itself is unchanged: the scorecard counts what was on
 * his screen whatever he did with it.
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

/** How the guard decides a day was not reviewed (Policy.learning.seenKept.guard). */
export interface ReviewGuard {
  readonly baselineDays: number;
  readonly minBaselineDays: number;
  readonly minSeenShare: number;
  readonly minNotShare: number;
}

/** One UTC day of what the owner saw: posts first seen that day, and how many of them he tapped Not a meme. */
export interface SeenDay {
  readonly day: string;
  readonly seen: number;
  readonly not: number;
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/**
 * The UTC days the guard takes as NOT reviewed: a day whose posts seen are under `minSeenShare` of
 * the median of the `baselineDays` days with anything seen before it, or whose Not a meme share is
 * under `minNotShare` of theirs. A day with fewer than `minBaselineDays` such days before it is never
 * left out: with no usual to compare with, nothing is unusual. `days` sorted oldest first.
 */
export function notReviewedDays(days: readonly SeenDay[], g: ReviewGuard): ReadonlySet<string> {
  const out = new Set<string>();
  const active = days.filter((d) => d.seen > 0);
  for (let i = 0; i < active.length; i++) {
    const d = active[i] as SeenDay;
    const before = active.slice(Math.max(0, i - g.baselineDays), i);
    if (before.length < g.minBaselineDays) continue;
    const usualSeen = median(before.map((b) => b.seen));
    const usualNot = median(before.map((b) => b.not / b.seen));
    if (d.seen < g.minSeenShare * usualSeen || d.not / d.seen < g.minNotShare * usualNot) out.add(d.day);
  }
  /* A day with nothing seen is no day of keeps either way. */
  return out;
}

const DAY_MS = 86_400_000;
const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

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

  /**
   * The ids of every kept post first seen in [since, until): the soft yes labels. Without `review`,
   * every kept post; with it, none first seen inside a `notReviewing` window or on a day the guard
   * finds was not reviewed (read over `guard.baselineDays` before `since` too, for the usual).
   */
  async keptIds(q: {
    readonly since: Date;
    readonly until: Date;
    readonly keepWindowMs: number;
    readonly now: Date;
    readonly review?: { readonly notReviewing: readonly { readonly from: string; readonly until: string }[]; readonly guard: ReviewGuard };
  }): Promise<ReadonlyMap<string, number>> {
    if (q.review === undefined) return new Map((await this.seen(q)).filter((r) => r.outcome === 'kept').map((r) => [r.itemId, r.firstSeenAtMs] as const));
    const R = q.review;
    const rows = await this.seen({ ...q, since: new Date(q.since.getTime() - R.guard.baselineDays * DAY_MS) });
    const byDay = new Map<string, { seen: number; not: number }>();
    for (const r of rows) {
      const k = utcDay(r.firstSeenAtMs);
      const d = byDay.get(k) ?? { seen: 0, not: 0 };
      d.seen += 1;
      if (r.call === 'not') d.not += 1;
      byDay.set(k, d);
    }
    const skipDays = notReviewedDays([...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, d]) => ({ day, ...d })), R.guard);
    const windows = R.notReviewing.map((w) => [Date.parse(w.from), Date.parse(w.until)] as const);
    const named = (ms: number): boolean => windows.some(([a, b]) => ms >= a && ms < b);
    return new Map(
      rows
        .filter((r) => r.outcome === 'kept' && r.firstSeenAtMs >= q.since.getTime() && !named(r.firstSeenAtMs) && !skipDays.has(utcDay(r.firstSeenAtMs)))
        .map((r) => [r.itemId, r.firstSeenAtMs] as const),
    );
  }
}
