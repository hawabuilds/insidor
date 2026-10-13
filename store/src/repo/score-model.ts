/**
 * The For You order model, as rows (0065): every fit the re-tune made, applied or not, and the
 * stored facts a labelled post's signals are made from.
 *
 * Its own repository because the projector reads exactly one thing here — the latest APPLIED fit —
 * and the fit reads the facts of posts that are mostly no longer on any feed. Keeping both reads in
 * one file keeps "which facts a signal is made of" in one place: the projector's own query
 * (services/project/src/rising.ts) must read the same columns the same way, or the fit is scored
 * on inputs it never saw.
 *
 * ★ A TABLE NOT YET MIGRATED IS "NO FIT". The projector may deploy before 0065 is applied;
 * `latestApplied` then answers null (today's order) instead of failing the frame. The crypto
 * attention table (0064) is read the same way: absent, every post's attention is missing.
 *
 * What breaks if changed carelessly: `latestApplied` filters on `applied`. Reading the latest row
 * would order the feed by a fit that FAILED its gate. And the picture match here leaves out the
 * post's own picture and its own coin's: a gold post compared with itself is a perfect match that
 * teaches the fit nothing a live post will ever show.
 */

import type { Db } from '../client.ts';

export interface StoredScoreTerm {
  readonly signal: string;
  readonly kind: 'value' | 'missing';
  readonly centre: number;
  readonly spread: number;
  readonly weight: number;
}

export interface AppliedScoreFit {
  readonly id: number;
  readonly intercept: number;
  readonly terms: readonly StoredScoreTerm[];
  readonly appliedAt: Date;
}

export interface ScoreFitRow {
  readonly fittedAt: Date;
  readonly features: readonly string[];
  readonly intercept: number;
  readonly terms: readonly StoredScoreTerm[];
  readonly fitN: number;
  readonly heldOut: Readonly<Record<string, unknown>>;
  readonly applied: boolean;
  readonly why: string | null;
}

/** One labelled post's stored facts, as the projector reads them for a live post. */
export interface StoredPostFacts {
  readonly itemId: string;
  readonly source: string;
  readonly postedAt: Date | null;
  readonly coinable: boolean | null;
  readonly confidence: number | null;
  readonly lookedAt: 'text' | 'picture' | 'videoFrame' | null;
  readonly proposedName: string | null;
  readonly kindLabel: string | null;
  readonly pictureSimilarity: number | null;
  /** Reach readings, oldest first: a measured level, or null for a censored one. */
  readonly readings: readonly { readonly atMs: number; readonly reach: number | null }[];
  readonly attention: number | null;
}

const UNDEFINED_TABLE = '42P01';
const isMissingTable = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === UNDEFINED_TABLE;

export class PgScoreModelRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** The fit the projector orders by, or null: none applied, or 0065 not applied here yet. */
  async latestApplied(): Promise<AppliedScoreFit | null> {
    try {
      const rows = await this.#db.query<{ id: string; intercept: number; terms: StoredScoreTerm[]; applied_at: Date }>(
        'select id, intercept, terms, applied_at from internal.score_model where applied order by applied_at desc, id desc limit 1',
      );
      const r = rows[0];
      return r === undefined ? null : { id: Number(r.id), intercept: Number(r.intercept), terms: r.terms, appliedAt: r.applied_at };
    } catch (e) {
      if (isMissingTable(e)) return null;
      throw e;
    }
  }

  async record(f: ScoreFitRow): Promise<number> {
    const rows = await this.#db.query<{ id: string }>(
      `insert into internal.score_model (fitted_at, features, intercept, terms, fit_n, held_out, applied, applied_at, why)
       values ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8, $9) returning id`,
      [f.fittedAt, [...f.features], f.intercept, JSON.stringify(f.terms), f.fitN, JSON.stringify(f.heldOut), f.applied, f.applied ? f.fittedAt : null, f.why],
    );
    return Number(rows[0]?.id);
  }

  /**
   * Each post's crypto attention (0064): from its newest read, the crypto accounts among its
   * repliers and quoters plus the contract-address mentions in them. An empty map when 0064 is not
   * applied here yet; a post with no read is missing, never zero.
   */
  async attention(itemIds: readonly string[]): Promise<ReadonlyMap<string, number>> {
    if (itemIds.length === 0) return new Map();
    const exists = await this.#db.query<{ t: string | null }>(`select to_regclass('internal.crypto_attention')::text as t`);
    if ((exists[0]?.t ?? null) === null) return new Map();
    const rows = await this.#db.query<{ item_id: string; v: number }>(
      `select distinct on (item_id) item_id, (crypto_repliers + crypto_quoters + ca_mentions)::double precision as v
         from internal.crypto_attention where item_id = any($1::text[])
        order by item_id, read_at desc`,
      [[...itemIds]],
    );
    return new Map(rows.map((r) => [r.item_id, Number(r.v)] as const));
  }

  /**
   * The stored facts of these posts, for the fit. Posts we do not hold are left out. `ownCoins`
   * names, per post, the coined-picture refs that are its own coin's, left out of its picture match.
   */
  async facts(itemIds: readonly string[], ownCoins: ReadonlyMap<string, readonly string[]> = new Map()): Promise<readonly StoredPostFacts[]> {
    if (itemIds.length === 0) return [];
    const ids = [...itemIds];
    const own = ids.map((id) => (ownCoins.get(id) ?? []).join('\u0001'));
    const rows = await this.#db.query<{
      item_id: string; source: string; posted_at: Date | null;
      coinable: boolean | null; confidence: number | null; looked_at: StoredPostFacts['lookedAt']; proposed_name: string | null;
      kind_label: string | null; similarity: number | null;
    }>(
      `select i.item_id, i.source, i.posted_at,
              j.coinable, j.confidence, j.looked_at, j.proposed_name, k.kind_label, pic.similarity
         from unnest($1::text[], $2::text[]) as x(item_id, own)
         join public.item i on i.item_id = x.item_id
         left join lateral (
                select pj.coinable, pj.confidence, pj.looked_at, pj.proposed_name
                  from internal.post_judgement pj
                 where pj.item_id = i.item_id and pj.prompt_id not like 'post-kind%'
                 order by pj.judged_at desc, pj.id desc limit 1
              ) j on true
         left join lateral (
                select case when pj.prompt_id like 'post-kind%' then pj.proposed_name end as kind_label
                  from internal.post_judgement pj
                 where pj.item_id = i.item_id
                 order by pj.judged_at desc, pj.id desc limit 1
              ) k on true
         left join lateral (
                select max(1 - (e.embedding <=> c.embedding)) as similarity
                  from internal.image_embedding e
                  join internal.coined_picture c on c.space = e.space and c.uri <> e.uri
                 where e.subject_kind = 'item' and e.subject_id = i.item_id
                   and c.coin_ref <> all(string_to_array(x.own, chr(1)))
              ) pic on true`,
      [ids, own],
    );
    const readings = await this.#db.query<{ item_id: string; captured_at: Date; level: number | null }>(
      `select item_id, captured_at, case when rate_per_min is not null then rate_level end as level
         from public.observation where item_id = any($1::text[]) and kind = 'reach'
        order by item_id, captured_at asc`,
      [ids],
    );
    const byItem = new Map<string, { atMs: number; reach: number | null }[]>();
    for (const r of readings) {
      const list = byItem.get(r.item_id) ?? [];
      list.push({ atMs: r.captured_at.getTime(), reach: r.level === null ? null : Number(r.level) });
      byItem.set(r.item_id, list);
    }
    const attention = await this.attention(ids);
    return rows.map((r) => ({
      itemId: r.item_id,
      source: r.source,
      postedAt: r.posted_at,
      coinable: r.coinable,
      confidence: r.confidence === null ? null : Number(r.confidence),
      lookedAt: r.looked_at,
      proposedName: r.proposed_name,
      kindLabel: r.kind_label,
      pictureSimilarity: r.similarity === null ? null : Number(r.similarity),
      readings: byItem.get(r.item_id) ?? [],
      attention: attention.get(r.item_id) ?? null,
    }));
  }
}
