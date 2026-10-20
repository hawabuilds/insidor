/**
 * The junk filter, as rows (0091): every fit the re-tune made, applied or not; each post the filter
 * kept from the judge, with how sure it was; and the vectors the fit is taught and tested on.
 *
 * Its own repository, apart from score-model.ts, because the runner reads exactly two things here —
 * the latest APPLIED fit, and "this post was not asked" — and neither may ever be mistaken for a
 * judge's answer. A skipped post has NO row in internal.post_judgement: every feed reader that takes
 * a post's newest answer sees "never judged", which is the truth, and keeps it off the feed.
 * The projector reads one more: the applied fit with its held-out table, for For You's junk bar
 * (Policy.rising.junkBar, services/project junk-bar.ts), and the vectors of the posts about to join.
 *
 * ★ A TABLE NOT YET MIGRATED IS "NO FIT". The runner may deploy before 0091 is applied:
 * `latestApplied` then answers null and every post goes to the judge as before. Recording a skip
 * needs the table, but a skip is only ever recorded under an applied fit read from the same
 * migration, so it cannot be reached without it.
 *
 * What breaks if changed carelessly: `latestApplied` filters on `applied`; reading the latest row
 * would let a fit that FAILED its held-out test drop posts. And `vectors` prefers the post's own
 * stored vector (0074, written by the runner as it judged) over the label's (0069): the first is
 * exactly what the runner scores live.
 */

import type { Db } from '../client.ts';

export interface JunkFitRow {
  readonly fittedAt: Date;
  /** The embedding space the weights are in; a vector of another space is never scored. */
  readonly space: string;
  readonly intercept: number;
  readonly weights: readonly number[];
  /** A post at or over this junk probability is not asked; null when no safe threshold was found. */
  readonly threshold: number | null;
  readonly fitN: number;
  readonly heldOut: Readonly<Record<string, unknown>>;
  readonly applied: boolean;
  readonly why: string | null;
}

export interface AppliedJunkFit {
  readonly id: number;
  readonly space: string;
  readonly intercept: number;
  readonly weights: readonly number[];
  readonly threshold: number;
}

export interface JunkSkip {
  readonly itemId: string;
  readonly fitId: number;
  readonly probability: number;
  readonly at: Date;
}

/** A post's vector and its words: the label's text when the post is not held. */
export interface PostVector {
  readonly itemId: string;
  readonly text: string;
  readonly values: Float32Array;
}

/** One row of a fit's held-out table: at `threshold`, how many of each label group's held-out posts it would drop. */
export interface HeldOutTableRow {
  readonly threshold: number;
  readonly dropped: Readonly<Record<string, { readonly tested: number; readonly dropped: number }>>;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** `held_out.table` read defensively: each row's threshold and every group with two counts. */
export function heldOutTable(heldOut: unknown): HeldOutTableRow[] {
  const table = typeof heldOut === 'object' && heldOut !== null ? (heldOut as { table?: unknown }).table : undefined;
  if (!Array.isArray(table)) return [];
  return table.flatMap((row: unknown) => {
    if (typeof row !== 'object' || row === null) return [];
    const { threshold, dropped } = row as { threshold?: unknown; dropped?: unknown };
    if (typeof threshold !== 'number' || !Number.isFinite(threshold) || typeof dropped !== 'object' || dropped === null) return [];
    const groups = Object.entries(dropped as Record<string, unknown>).flatMap(([g, d]) => {
      const { tested, dropped: n } = (typeof d === 'object' && d !== null ? d : {}) as { tested?: unknown; dropped?: unknown };
      return isCount(tested) && isCount(n) ? [[g, { tested, dropped: n }] as const] : [];
    });
    return [{ threshold, dropped: Object.fromEntries(groups) }];
  });
}

const UNDEFINED_TABLE = '42P01';
const isMissingTable = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === UNDEFINED_TABLE;

/** pgvector's text form, `[0.1,0.2,…]`, as numbers. */
const parseVector = (v: unknown): Float32Array => {
  const s = String(v ?? '').replace(/^\[|\]$/g, '');
  return s === '' ? new Float32Array() : Float32Array.from(s.split(',').map(Number));
};

export class PgJunkFilterRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * The fit the runner filters with, or null: none applied, or 0091 not applied here yet. With
   * `space`, the latest of that space; without, the latest of any (core `junkVerdict` then refuses a
   * vector of another space).
   */
  async latestApplied(space: string | null = null): Promise<AppliedJunkFit | null> {
    try {
      const rows = await this.#db.query<{ id: string; space: string; intercept: number; weights: number[]; threshold: number }>(
        `select id, space, intercept, weights, threshold from internal.junk_filter
          where applied and ($1::text is null or space = $1) and threshold is not null order by applied_at desc, id desc limit 1`,
        [space],
      );
      const r = rows[0];
      return r === undefined ? null : { id: Number(r.id), space: r.space, intercept: Number(r.intercept), weights: r.weights.map(Number), threshold: Number(r.threshold) };
    } catch (e) {
      if (isMissingTable(e)) return null;
      throw e;
    }
  }

  /**
   * The applied fit with its own held-out table (`held_out.table`, tools/lib/junk-filter.ts), for
   * For You's junk bar (Policy.rising.junkBar). Rows that are not the table's shape are left out, so
   * a fit recorded before the table had a group is read as not having tested it, never as having
   * dropped nothing. Null as `latestApplied`.
   */
  async latestAppliedTable(space: string | null = null): Promise<{ readonly fit: AppliedJunkFit; readonly table: readonly HeldOutTableRow[] } | null> {
    try {
      const rows = await this.#db.query<{ id: string; space: string; intercept: number; weights: number[]; threshold: number; held_out: unknown }>(
        `select id, space, intercept, weights, threshold, held_out from internal.junk_filter
          where applied and ($1::text is null or space = $1) and threshold is not null order by applied_at desc, id desc limit 1`,
        [space],
      );
      const r = rows[0];
      if (r === undefined) return null;
      const fit = { id: Number(r.id), space: r.space, intercept: Number(r.intercept), weights: r.weights.map(Number), threshold: Number(r.threshold) };
      return { fit, table: heldOutTable(r.held_out) };
    } catch (e) {
      if (isMissingTable(e)) return null;
      throw e;
    }
  }

  /** Writes one fit; null before 0091. */
  async record(f: JunkFitRow): Promise<number | null> {
    try {
      const rows = await this.#db.query<{ id: string }>(
        `insert into internal.junk_filter (fitted_at, space, intercept, weights, threshold, fit_n, held_out, applied, applied_at, why)
         values ($1, $2, $3, $4::double precision[], $5, $6, $7::jsonb, $8, $9, $10) returning id`,
        [f.fittedAt, f.space, f.intercept, [...f.weights], f.threshold, f.fitN, JSON.stringify(f.heldOut), f.applied, f.applied ? f.fittedAt : null, f.why],
      );
      return Number(rows[0]?.id);
    } catch (e) {
      if (isMissingTable(e)) return null;
      throw e;
    }
  }

  /** Records that these posts were not asked: the filter was sure enough they are junk. Once per post. */
  async recordSkips(rows: readonly JunkSkip[]): Promise<void> {
    if (rows.length === 0) return;
    await this.#db.query(
      `insert into internal.junk_skip (item_id, fit_id, probability, skipped_at)
       select * from unnest($1::text[], $2::bigint[], $3::double precision[], $4::timestamptz[])
       on conflict (item_id) do nothing`,
      [rows.map((r) => r.itemId), rows.map((r) => r.fitId), rows.map((r) => r.probability), rows.map((r) => r.at)],
    );
  }

  /** These posts' vectors in `space`: the runner's own (0074) first, else the label's (0069). */
  async vectors(itemIds: readonly string[], space: string): Promise<ReadonlyMap<string, PostVector>> {
    const out = new Map<string, PostVector>();
    if (itemIds.length === 0) return out;
    const read = async (sql: string): Promise<void> => {
      try {
        const rows = await this.#db.query<{ item_id: string; text: string | null; embedding: unknown }>(sql, [[...itemIds], space]);
        for (const r of rows) if (!out.has(r.item_id)) out.set(r.item_id, { itemId: r.item_id, text: r.text ?? '', values: parseVector(r.embedding) });
      } catch (e) {
        if (!isMissingTable(e)) throw e;
      }
    };
    await read(`select e.item_id, coalesce(i.body, l.text) as text, e.embedding::text as embedding
                  from internal.post_embedding e
                  left join public.item i on i.item_id = e.item_id
                  left join internal.label_embedding l on l.item_id = e.item_id and l.space = e.space
                 where e.item_id = any($1::text[]) and e.space = $2`);
    await read(`select item_id, text, embedding::text as embedding from internal.label_embedding where item_id = any($1::text[]) and space = $2`);
    return out;
  }

  /**
   * Every post the live judge answered the post question for since `since` (not a copy, not a rule,
   * not a kind answer) that has a vector: the traffic the filter would see, with the judge's answer
   * and what the answer cost.
   */
  async judgedSince(since: Date, space: string): Promise<readonly (PostVector & { readonly coinable: boolean; readonly costUsd: number })[]> {
    try {
      const rows = await this.#db.query<{ item_id: string; text: string | null; embedding: unknown; coinable: boolean; cost_usd: string }>(
        `select j.item_id, i.body as text, e.embedding::text as embedding, j.coinable, j.cost_usd::text as cost_usd
           from (select distinct on (item_id) item_id, coinable, cost_usd from internal.post_judgement
                  where judged_at >= $1 and prompt_id not like 'post-kind%' and judge_id not like 'rule:%' and copied_from is null
                  order by item_id, judged_at, id) j
           join internal.post_embedding e on e.item_id = j.item_id and e.space = $2
           left join public.item i on i.item_id = j.item_id`,
        [since, space],
      );
      return rows.map((r) => ({ itemId: r.item_id, text: r.text ?? '', values: parseVector(r.embedding), coinable: r.coinable, costUsd: Number(r.cost_usd) }));
    } catch (e) {
      if (isMissingTable(e)) return [];
      throw e;
    }
  }
}
