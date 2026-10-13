/**
 * Recall: how much of what started a coin our discovery had, and when. The reads the recall
 * model is fed from (the floors, how far back each lane actually reached, how often a pass ran,
 * how approvals grew) and the daily check's own rows (internal.recall_check, 0047).
 *
 * Its own repository because every read here is ABOUT the pipeline rather than part of it: no
 * stage reads these to decide anything, and a query added here for a report must never become
 * one a stage depends on. Keeping them apart also keeps the one write (`record`) next to the
 * status read that summarises it, so the two agree on what "caught" means.
 *
 * What breaks if changed carelessly: the measured lane reach. It is the age at which each lane
 * FOUND its posts, not the window the query asked for — the slow lane asks for six hours and,
 * capped at a few pages newest first, reaches back well under one. Replacing the measurement with
 * the configured window would make the model credit the slow lane with posts it never returns.
 */

import type { Millis } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { toMillis, toTimestamp, type TimestampColumn } from '../rows.ts';

/** How one catch-all lane behaved over the measured span. Minutes throughout. */
export interface LaneMeasured {
  readonly lane: string;
  readonly found: number;
  /** Age at which the lane found its posts: median and 95th percentile. Null when it found none. */
  readonly medianAgeMin: number | null;
  readonly p95AgeMin: number | null;
  /** Median time between two passes on which the lane found something new. Null under two passes. */
  readonly passGapMin: number | null;
}

/** The first and last approval reading of one post, with its age at each. */
export interface GrowthPair {
  readonly ageFirstMin: number;
  readonly approvalsFirst: number;
  readonly ageLastMin: number;
  readonly approvalsLast: number;
}

export interface RecallRow {
  readonly mint: string;
  readonly coinName: string | null;
  readonly launchedAt: Millis | null;
  readonly bondedAt: Millis;
  readonly postLink: string;
  readonly postPlatform: 'x' | 'tiktok' | 'instagram';
  readonly postId: string;
  readonly postedAt: Millis | null;
  readonly firstSeenAt: Millis | null;
  readonly caught: boolean | null;
  readonly leadMinutes: number | null;
  readonly missReason: string | null;
  readonly approvalsNow: number | null;
}

export interface RecallRun {
  readonly bonded: number;
  readonly metadataRead: number;
  readonly linkedPost: number;
  readonly sourceCredits: number | null;
  readonly xUsd: number;
}

export interface RecallDay {
  readonly day: string;
  readonly bonded: number | null;
  readonly linkedPost: number | null;
  /** Coins asked about (caught is not null) — the rate's denominator. */
  readonly asked: number;
  readonly caught: number;
  /** Mean minutes of lead over the caught coins; null when none was caught. */
  readonly meanLeadMin: number | null;
  readonly medianLeadMin: number | null;
  /** Posts we did hold, but only after the coin launched, and how late (minutes) at the median. */
  readonly seenLate: number;
  readonly medianLateMin: number | null;
  readonly reasons: Readonly<Record<string, number>>;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export class PgRecallRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** How each catch-all lane behaved since `sinceMs`, from which lane first found each post. */
  async lanes(sinceMs: Millis): Promise<readonly LaneMeasured[]> {
    const rows = await this.#db.query<{ lane: string; found: string; med: number | null; p95: number | null; gap: number | null }>(
      `with found as (
         select f.lane, f.found_at, extract(epoch from f.found_at - i.posted_at) / 60 as age_min
           from internal.item_found_by f
           join public.item i using (item_id)
          where f.found_at >= $1 and i.posted_at is not null
       ),
       passes as (
         select lane, extract(epoch from found_at - lag(found_at) over (partition by lane order by found_at)) / 60 as gap_min
           from (select distinct lane, found_at from found) p
       )
       select f.lane, count(*) as found,
              percentile_cont(0.5) within group (order by f.age_min) as med,
              percentile_cont(0.95) within group (order by f.age_min) as p95,
              (select percentile_cont(0.5) within group (order by gap_min) from passes p where p.lane = f.lane and gap_min is not null) as gap
         from found f
        group by f.lane
        order by f.lane`,
      [toTimestamp(sinceMs)],
    );
    return rows.map((r) => ({ lane: r.lane, found: Number(r.found), medianAgeMin: num(r.med), p95AgeMin: num(r.p95), passGapMin: num(r.gap) }));
  }

  /**
   * The first and last approval reading of every post from `source` read at least `minSpanMin`
   * apart, since `sinceMs` — what the growth curve is fitted to.
   */
  async growthPairs(source: string, sinceMs: Millis, minSpanMin: number): Promise<readonly GrowthPair[]> {
    const rows = await this.#db.query<{ a1: number; v1: number; a2: number; v2: number }>(
      `with o as (
         select o.item_id, extract(epoch from o.observed_at - i.posted_at) / 60 as age, o.value::float8 as v,
                row_number() over (partition by o.item_id order by o.observed_at) as first_n,
                row_number() over (partition by o.item_id order by o.observed_at desc) as last_n
           from public.observation o
           join public.item i using (item_id)
          where i.source = $1 and o.kind = 'approval' and o.value is not null and i.posted_at is not null
            and i.first_seen_at >= $2
       )
       select f.age as a1, f.v as v1, l.age as a2, l.v as v2
         from o f join o l on l.item_id = f.item_id and l.last_n = 1
        where f.first_n = 1 and l.age - f.age >= $3 and f.age > 0 and f.v > 0`,
      [source, toTimestamp(sinceMs), minSpanMin],
    );
    return rows.map((r) => ({ ageFirstMin: Number(r.a1), approvalsFirst: Number(r.v1), ageLastMin: Number(r.a2), approvalsLast: Number(r.v2) }));
  }

  /** When each of these posts first reached public.item, for those that did. */
  async firstSeen(source: string, sourceItemIds: readonly string[]): Promise<ReadonlyMap<string, Millis>> {
    if (sourceItemIds.length === 0) return new Map();
    const rows = await this.#db.query<{ source_item_id: string; first_seen_at: TimestampColumn }>(
      `select source_item_id, min(first_seen_at) as first_seen_at
         from public.item
        where source = $1 and source_item_id = any($2::text[])
        group by source_item_id`,
      [source, [...sourceItemIds]],
    );
    const out = new Map<string, Millis>();
    for (const r of rows) {
      const at = toMillis(r.first_seen_at);
      if (at !== null) out.set(r.source_item_id, at);
    }
    return out;
  }

  /** Whether discovery stored any post from `source` in [fromMs, toMs] — was it running at all. */
  async storedBetween(source: string, fromMs: Millis, toMs: Millis): Promise<boolean> {
    const rows = await this.#db.query<{ any: boolean }>(
      `select exists (select 1 from public.item where source = $1 and first_seen_at between $2 and $3) as any`,
      [source, toTimestamp(fromMs), toTimestamp(toMs)],
    );
    return rows[0]?.any === true;
  }

  /** When the daily check last ran, or null when it never has. */
  async lastRanAt(): Promise<Millis | null> {
    const rows = await this.#db.query<{ at: TimestampColumn }>('select max(ran_at) as at from internal.recall_check_run');
    return toMillis(rows[0]?.at ?? null);
  }

  /** One day's run and its rows, replacing whatever that day held. Run inside a transaction. */
  async record(day: string, at: Millis, run: RecallRun, rows: readonly RecallRow[]): Promise<void> {
    await this.#db.query('delete from internal.recall_check where day = $1', [day]);
    for (const r of rows) {
      await this.#db.query(
        `insert into internal.recall_check
           (mint, day, coin_name, launched_at, bonded_at, post_link, post_platform, post_id, posted_at,
            first_seen_at, caught, lead_minutes, miss_reason, approvals_now, checked_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         on conflict (mint, day) do nothing`,
        [
          r.mint, day, r.coinName, toTimestamp(r.launchedAt), toTimestamp(r.bondedAt), r.postLink, r.postPlatform, r.postId,
          toTimestamp(r.postedAt), toTimestamp(r.firstSeenAt), r.caught, r.leadMinutes, r.missReason, r.approvalsNow, toTimestamp(at),
        ],
      );
    }
    await this.#db.query(
      `insert into internal.recall_check_run (day, ran_at, bonded, metadata_read, linked_post, source_credits, x_usd)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (day) do update set ran_at = excluded.ran_at, bonded = excluded.bonded, metadata_read = excluded.metadata_read,
         linked_post = excluded.linked_post, source_credits = excluded.source_credits, x_usd = excluded.x_usd`,
      [day, toTimestamp(at), run.bonded, run.metadataRead, run.linkedPost, run.sourceCredits, run.xUsd],
    );
  }

  /** The last `days` days of checks, newest first: catch rate, lead, and the miss reasons. */
  async status(days: number): Promise<readonly RecallDay[]> {
    const rows = await this.#db.query<{
      day: string; bonded: number | null; linked_post: number | null; asked: string; caught: string;
      mean_lead: number | null; median_lead: number | null; seen_late: string; median_late: number | null; reasons: Record<string, number> | null;
    }>(
      `with d as (
         select day::text as day from internal.recall_check_run
         union select day::text from internal.recall_check
       )
       select d.day, r.bonded, r.linked_post,
              (select count(*) from internal.recall_check c where c.day::text = d.day and c.caught is not null) as asked,
              (select count(*) from internal.recall_check c where c.day::text = d.day and c.caught) as caught,
              (select avg(lead_minutes) from internal.recall_check c where c.day::text = d.day and c.caught) as mean_lead,
              (select percentile_cont(0.5) within group (order by lead_minutes) from internal.recall_check c where c.day::text = d.day and c.caught) as median_lead,
              (select count(*) from internal.recall_check c where c.day::text = d.day and c.caught = false and c.first_seen_at is not null) as seen_late,
              (select percentile_cont(0.5) within group (order by -lead_minutes) from internal.recall_check c
                where c.day::text = d.day and c.caught = false and c.first_seen_at is not null) as median_late,
              (select jsonb_object_agg(miss_reason, n) from (
                 select miss_reason, count(*) as n from internal.recall_check c
                  where c.day::text = d.day and miss_reason is not null group by miss_reason) x) as reasons
         from d left join internal.recall_check_run r on r.day::text = d.day
        order by d.day desc
        limit $1`,
      [days],
    );
    return rows.map((r) => ({
      day: r.day,
      bonded: num(r.bonded),
      linkedPost: num(r.linked_post),
      asked: Number(r.asked),
      caught: Number(r.caught),
      meanLeadMin: num(r.mean_lead),
      medianLeadMin: num(r.median_lead),
      seenLate: Number(r.seen_late),
      medianLateMin: num(r.median_late),
      reasons: Object.fromEntries(Object.entries(r.reasons ?? {}).map(([k, v]) => [k, Number(v)])),
    }));
  }
}
