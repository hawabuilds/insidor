/**
 * The viral exception's queue and answers (0138, Policy.judge.viral): which huge posts the judge
 * turned down are still to be asked, the answers once they are, and the answers the projector reads.
 *
 * Its own repository because its table is read by exactly two things — the runner's queue
 * (work/viral-moments.ts) and the projector's viral route (services/project rising.ts) — and by
 * nothing that reads a post's newest judgement. Keeping it apart is what keeps a viral answer from
 * ever being taken for the post question's verdict.
 *
 * ★ THE QUEUE IS A DATABASE NARROWING, CORE DECIDES. `due` returns the posts with any reading at
 * `minReach` since `since` — and `dueEarly` (policy.v188) those fast in their first minutes — never
 * asked, with their first answer and the kind that holds them read exactly as the projector reads
 * them (the newest post-question answer; the kind label only while a kind answer is the newest of
 * all); the runner then holds each to core `viralEligible` and `clearsViralBar` or
 * `clearsEarlyViralBar`. Only posts a catch-all lane credited: no other post can reach For You's frame.
 *
 * What breaks if changed carelessly: `answers` THROWS when the table is missing (before 0138). The
 * projector catches that and passes no post this way; returning an empty map silently here would
 * hide a migration that was never applied.
 */

import type { Millis } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { toTimestamp } from '../rows.ts';

/** A post the queue found: what the runner needs to hold it to core's rules. */
export interface ViralDue {
  readonly itemId: string;
  readonly postedAtMs: number | null;
  /** The newest post-question answer's yes or no. */
  readonly firstCoinable: boolean;
  /** The kind label, only while a kind answer is the post's newest answer; else null. */
  readonly kindLabel: string | null;
}

/** One answered ask, as written. */
export interface ViralRecord {
  readonly itemId: string;
  readonly askedAt: Date;
  readonly judgeId: string;
  readonly moment: boolean;
  readonly confidence: number;
  readonly name: string | null;
  readonly kindJudgeId: string | null;
  readonly kind: string | null;
  /** Times the kind question was asked: 0 for a "no" moment or a rule's answer. */
  readonly kindAsks: number;
  readonly costUsd: number;
}

/** What the projector reads per post. */
export interface StoredViral {
  readonly moment: boolean;
  readonly confidence: number;
  readonly name: string | null;
  readonly kind: string | null;
}

export class PgViralMomentRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** See the header. Biggest reading first, at most `limit`. */
  async due(args: { readonly since: Millis; readonly minReach: number; readonly liftsKinds: readonly string[]; readonly heldKinds: readonly string[]; readonly limit: number }): Promise<readonly ViralDue[]> {
    if (args.limit <= 0) return [];
    return this.#eligible(
      `select o.item_id, max(o.value) as top
         from public.observation o
        where o.kind = 'reach' and o.captured_at >= $1 and o.value >= $2
        group by o.item_id`,
      [toTimestamp(args.since), args.minReach],
      args,
    );
  }

  /**
   * ★ THE EARLY QUEUE (Policy.judge.viral.early, policy.v188): posts with a reading within `withinMs`
   * of their post time averaging `minPerMinute` views a minute or more since it, fastest first, held
   * to the same eligibility as `due`. Core `clearsEarlyViralBar` decides again on the readings.
   */
  async dueEarly(args: { readonly since: Millis; readonly minPerMinute: number; readonly withinMs: number; readonly liftsKinds: readonly string[]; readonly heldKinds: readonly string[]; readonly limit: number }): Promise<readonly ViralDue[]> {
    if (args.limit <= 0) return [];
    return this.#eligible(
      `select o.item_id, max(o.value / (extract(epoch from (o.captured_at - i.posted_at)) / 60.0)) as top
         from public.item i
         join public.observation o on o.item_id = i.item_id
        where i.posted_at >= $1 and o.kind = 'reach' and o.value is not null
          and o.captured_at > i.posted_at and o.captured_at <= i.posted_at + make_interval(secs => $3::float8 / 1000)
        group by o.item_id
       having max(o.value / (extract(epoch from (o.captured_at - i.posted_at)) / 60.0)) >= $2`,
      [toTimestamp(args.since), args.minPerMinute, args.withinMs],
      args,
    );
  }

  /**
   * The queue's shared tail: of the posts `found` names (item_id, top), the ones still to ask — see
   * the header — biggest `top` first. `found`'s own parameters come first; this appends its own.
   */
  async #eligible(found: string, params: readonly unknown[], args: { readonly since: Millis; readonly liftsKinds: readonly string[]; readonly heldKinds: readonly string[]; readonly limit: number }): Promise<readonly ViralDue[]> {
    const n = params.length;
    const rows = await this.#db.query<{ item_id: string; posted_at: Date | string | null; coinable: boolean; kind_label: string | null }>(
      `with big as (${found})
       select b.item_id, i.posted_at, j.coinable, k.kind_label
         from big b
         join public.item i on i.item_id = b.item_id
         left join lateral (
                select pj.coinable from internal.post_judgement pj
                 where pj.item_id = b.item_id and pj.prompt_id not like 'post-kind%'
                 order by pj.judged_at desc, pj.id desc limit 1
              ) j on true
         left join lateral (
                select case when pj.prompt_id like 'post-kind%' then upper(trim(pj.proposed_name)) end as kind_label
                  from internal.post_judgement pj
                 where pj.item_id = b.item_id
                 order by pj.judged_at desc, pj.id desc limit 1
              ) k on true
        where i.origin = 'observed'
          and i.posted_at >= $${n + 1}
          and j.coinable is not null
          and (not j.coinable or k.kind_label = any($${n + 2}::text[]))
          and (k.kind_label is null or k.kind_label = any($${n + 2}::text[]) or not (k.kind_label = any($${n + 3}::text[])))
          and exists (select 1 from internal.item_found_by f where f.item_id = b.item_id)
          and not exists (select 1 from internal.viral_moment v where v.item_id = b.item_id)
          and coalesce((select ofb.verdict from internal.owner_feedback ofb
                         where ofb.subject_kind = 'post' and ofb.item_id = b.item_id
                         order by ofb.created_at desc, ofb.id desc limit 1), '') <> 'not'
        order by b.top desc
        limit $${n + 4}`,
      [...params, toTimestamp(args.since), [...args.liftsKinds], [...args.heldKinds], args.limit],
    );
    return rows.map((r) => ({
      itemId: r.item_id,
      postedAtMs: r.posted_at === null ? null : new Date(r.posted_at).getTime(),
      firstCoinable: r.coinable,
      kindLabel: r.kind_label,
    }));
  }

  /** Writes one answered ask; a post already answered keeps its first answer. */
  async record(r: ViralRecord): Promise<void> {
    await this.#db.query(
      `insert into internal.viral_moment (item_id, asked_at, judge_id, moment, confidence, name, kind_judge_id, kind, kind_asks, cost_usd)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (item_id) do nothing`,
      [r.itemId, r.askedAt, r.judgeId, r.moment, Math.min(1, Math.max(0, r.confidence)), r.name, r.kindJudgeId, r.kind, Math.max(0, Math.floor(r.kindAsks)), Math.max(0, r.costUsd)],
    );
  }

  /** "Yes" moments asked since `since` whose kind is still unnamed after fewer than `maxAsks` asks; oldest first. */
  async kindDue(args: { readonly since: Millis; readonly maxAsks: number; readonly limit: number }): Promise<readonly string[]> {
    if (args.limit <= 0) return [];
    const rows = await this.#db.query<{ item_id: string }>(
      `select item_id from internal.viral_moment
        where moment and kind is null and kind_asks < $2 and asked_at >= $1
        order by asked_at asc
        limit $3`,
      [toTimestamp(args.since), args.maxAsks, args.limit],
    );
    return rows.map((r) => r.item_id);
  }

  /** One more kind ask about a "yes" moment: its answer when it named one (only while none is stored), and the count. */
  async recordKind(itemId: string, answer: { readonly judgeId: string; readonly kind: string } | null, costUsd: number): Promise<void> {
    await this.#db.query(
      `update internal.viral_moment
          set kind_asks = kind_asks + 1,
              kind = coalesce(kind, $2),
              kind_judge_id = case when kind is null then coalesce($3, kind_judge_id) else kind_judge_id end,
              cost_usd = cost_usd + $4
        where item_id = $1 and moment`,
      [itemId, answer?.kind ?? null, answer?.judgeId ?? null, Math.max(0, costUsd)],
    );
  }

  /** The stored answers for these posts; a post never asked is absent. Throws when the table is missing. */
  async answers(itemIds: readonly string[]): Promise<ReadonlyMap<string, StoredViral>> {
    if (itemIds.length === 0) return new Map();
    const rows = await this.#db.query<{ item_id: string; moment: boolean; confidence: number; name: string | null; kind: string | null }>(
      'select item_id, moment, confidence, name, kind from internal.viral_moment where item_id = any($1::text[])',
      [[...itemIds]],
    );
    return new Map(rows.map((r) => [r.item_id, { moment: r.moment, confidence: Number(r.confidence), name: r.name, kind: r.kind }] as const));
  }
}
