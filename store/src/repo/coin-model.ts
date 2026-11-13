/**
 * Our own coin model, as rows (0096): every fit the re-tune made, every post the runner scored, and
 * the facts a post is scored on — read AS OF the moment the judge answered it.
 *
 * Its own repository because the one thing that must never go wrong here is time: the fit is taught
 * and tested on facts as of each post's decision, and the runner scores on the same query, so a
 * reading taken after the judge answered can never leak into either. `facts` takes the decision
 * instant with each post and reads only readings captured at or before it.
 *
 * ★ A TABLE NOT YET MIGRATED IS "NO FIT". The runner may deploy before 0096 is applied:
 * `latestApplied` then answers null and nothing is scored; the projector's read answers no scores.
 * Before 0099's `target` column, the coined target reads and writes as 0096 had it (every row then
 * was coined), so the runner may deploy first; any other target has no fit and scores nothing.
 *
 * ★ EVERY FIT AND SCORE HAS A TARGET (0099): what the fit predicts (contracts COIN_MODEL_TARGETS).
 * Each target has its own latest applied fit and scores a post once; a reader of would-add names
 * the target it acts on.
 *
 * What breaks if changed carelessly: `latestApplied` filters on `applied` (a fit that failed its
 * gate must never score the live target; `latestForShadow` is for a target that cannot act); `facts` must keep its `<= decided_at` bounds on every reading; and
 * `toScore` must read the NEWEST answer, the one For You acts on.
 */

import type { CoinModelTarget } from '@insidor/contracts/policy.ts';

import type { Db } from '../client.ts';
import { CURRENT_COIN_CALLS } from './owner-coin-calls.ts';

const UNDEFINED_TABLE = '42P01';
/* 0099's `target` column before 0099 is applied: the coined target reads and writes as 0096 had it, any other is "no fit". */
const UNDEFINED_COLUMN = '42703';
const codeOf = (e: unknown): string | null => (typeof e === 'object' && e !== null ? String((e as { code?: unknown }).code) : null);
const isMissingColumn = (e: unknown): boolean => codeOf(e) === UNDEFINED_COLUMN;
const isMissingTable = (e: unknown): boolean => codeOf(e) === UNDEFINED_TABLE || isMissingColumn(e);
async function orNone<R>(read: () => Promise<readonly R[]>): Promise<readonly R[]> {
  try {
    return await read();
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
}

/** One post's facts at its decision, as read (core `CoinFacts` is built from this). */
export interface CoinFactRow {
  readonly itemId: string;
  readonly decidedAt: Date;
  readonly source: string;
  readonly lang: string | null;
  readonly text: string;
  readonly mediaKinds: readonly string[];
  readonly postedAt: Date | null;
  readonly firstSeenAt: Date | null;
  readonly reach: number | null;
  readonly reachAt: Date | null;
  readonly ratePerMinute: number | null;
  readonly priorRatePerMinute: number | null;
  readonly approval: number | null;
  readonly conversation: number | null;
  readonly rebroadcast: number | null;
  readonly followers: number | null;
  readonly echoes: number | null;
  /** Coins linked to the post that were launched and found by the decision. */
  readonly coins: number | null;
}

/** A post's first answer from the live judge (not a rule, not a copy, not the kind question). */
export interface FirstAnswer {
  readonly itemId: string;
  readonly judgedAt: Date;
  readonly judgeId: string;
  readonly coinable: boolean;
  readonly confidence: number;
  /** The newest such answer's: what For You acts on. */
  readonly newestCoinable: boolean;
}

export interface CoinModelFitRow {
  readonly target: CoinModelTarget;
  readonly fittedAt: Date;
  readonly space: string;
  readonly intercept: number;
  readonly names: readonly string[];
  readonly means: readonly number[];
  readonly spreads: readonly number[];
  readonly weights: readonly number[];
  readonly vectorWeights: readonly number[];
  readonly threshold: number | null;
  readonly fitN: number;
  readonly heldOut: Readonly<Record<string, unknown>>;
  readonly applied: boolean;
  readonly why: string | null;
}

export interface AppliedCoinModel {
  readonly id: number;
  readonly target: CoinModelTarget;
  readonly fittedAt: Date;
  readonly space: string;
  readonly intercept: number;
  readonly names: readonly string[];
  readonly means: readonly number[];
  readonly spreads: readonly number[];
  readonly weights: readonly number[];
  readonly vectorWeights: readonly number[];
  readonly threshold: number;
  readonly heldOut: Readonly<Record<string, unknown>>;
}

export interface CoinModelScore {
  readonly itemId: string;
  readonly target: CoinModelTarget;
  readonly fitId: number;
  readonly probability: number;
  readonly threshold: number;
  readonly wouldAdd: boolean;
  readonly answerJudgedAt: Date;
  readonly scoredAt: Date;
  readonly mode: 'shadow' | 'live';
}

/** A post the judge said no to that has no score yet. */
export interface ToScore {
  readonly itemId: string;
  readonly answerJudgedAt: Date;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * The facts of each (post, decision) pair. Every reading is the newest captured at or before the
 * decision; the account's follower count is the stored one (it moves slowly and is never read per
 * post time), stated in the fit's notes.
 */
const FACTS_SQL = `
with d as (select * from unnest($1::text[], $2::timestamptz[]) as d(item_id, decided_at)),
     /* One scan for the posts that rebroadcast these: rebroadcast_of has no index of its own. */
     e as materialized (select q.rebroadcast_of as item_id, q.first_seen_at from public.item q where q.rebroadcast_of is not null)
select d.item_id, d.decided_at, i.source, i.lang, coalesce(i.body, '') as body,
       coalesce((select array_agg(x->>'kind') from jsonb_array_elements(case when jsonb_typeof(i.media) = 'array' then i.media else '[]'::jsonb end) x), '{}') as kinds,
       i.posted_at, i.first_seen_at, a.follower_count,
       r.value as reach, r.captured_at as reach_at, r.rate_per_min, r.prior_rate,
       (select o.value from public.observation o where o.item_id = d.item_id and o.kind = 'approval' and o.captured_at <= d.decided_at order by o.captured_at desc limit 1) as approval,
       (select o.value from public.observation o where o.item_id = d.item_id and o.kind = 'conversation' and o.captured_at <= d.decided_at order by o.captured_at desc limit 1) as conversation,
       (select o.value from public.observation o where o.item_id = d.item_id and o.kind = 'rebroadcast' and o.captured_at <= d.decided_at order by o.captured_at desc limit 1) as rebroadcast,
       (select count(*) from e where e.item_id = d.item_id and e.first_seen_at <= d.decided_at) as echoes,
       (select count(distinct l.address) from internal.coin_post_link l
         where l.source = i.source and l.source_item_id = i.source_item_id and l.minted_at <= d.decided_at and l.found_at <= d.decided_at) as coins
  from d
  join public.item i on i.item_id = d.item_id
  left join public.author a on a.author_key = i.author_key
  left join lateral (
    select o.value, o.captured_at, o.rate_per_min, lag(o.rate_per_min) over (order by o.captured_at) as prior_rate
      from public.observation o where o.item_id = d.item_id and o.kind = 'reach' and o.captured_at <= d.decided_at
     order by o.captured_at desc limit 1
  ) r on true`;

export class PgCoinModelRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** The facts of these posts, each as of its own decision. Posts we do not hold are absent. */
  async facts(pairs: readonly { readonly itemId: string; readonly decidedAt: Date }[]): Promise<readonly CoinFactRow[]> {
    if (pairs.length === 0) return [];
    const rows = await this.#db.query<Record<string, unknown>>(FACTS_SQL, [pairs.map((p) => p.itemId), pairs.map((p) => p.decidedAt)]);
    return rows.map((r) => ({
      itemId: String(r['item_id']),
      decidedAt: r['decided_at'] as Date,
      source: String(r['source']),
      lang: (r['lang'] as string | null) ?? null,
      text: String(r['body'] ?? ''),
      mediaKinds: ((r['kinds'] as (string | null)[] | null) ?? []).filter((k): k is string => k !== null),
      postedAt: (r['posted_at'] as Date | null) ?? null,
      firstSeenAt: (r['first_seen_at'] as Date | null) ?? null,
      reach: num(r['reach']),
      reachAt: (r['reach_at'] as Date | null) ?? null,
      ratePerMinute: num(r['rate_per_min']),
      priorRatePerMinute: num(r['prior_rate']),
      approval: num(r['approval']),
      conversation: num(r['conversation']),
      rebroadcast: num(r['rebroadcast']),
      followers: num(r['follower_count']),
      echoes: num(r['echoes']),
      coins: num(r['coins']),
    }));
  }

  /** Every post's first live answer since `since`, with its newest one's verdict. */
  async firstAnswers(since: Date): Promise<readonly FirstAnswer[]> {
    const rows = await this.#db.query<{ item_id: string; judged_at: Date; judge_id: string; coinable: boolean; confidence: number; newest: boolean }>(
      `with a as (
         select item_id, judged_at, id, judge_id, coinable, confidence from internal.post_judgement
          where prompt_id not like 'post-kind%' and judge_id not like 'rule:%' and copied_from is null and judged_at >= $1
       )
       select f.item_id, f.judged_at, f.judge_id, f.coinable, f.confidence, n.coinable as newest
         from (select distinct on (item_id) * from a order by item_id, judged_at, id) f
         join (select distinct on (item_id) item_id, coinable from a order by item_id, judged_at desc, id desc) n using (item_id)`,
      [since],
    );
    return rows.map((r) => ({ itemId: r.item_id, judgedAt: r.judged_at, judgeId: r.judge_id, coinable: r.coinable, confidence: Number(r.confidence), newestCoinable: r.newest }));
  }

  /**
   * Every post a coin was launched for `lateMs` or more after it was posted: the coin's metadata
   * names the post (0083) or the owner called it the post's coin. An account that coins its own
   * posts (`deployerMinPosts` posts coined inside `deployerWindowMs` of posting) is left out, as
   * learning.ts `coinedPosts` does, but with no text or answer condition: a picture-only post that
   * people coined is a coined post. The post time is the held post's, else the id's own (X ids
   * carry it); a coin with no launch time is not counted.
   */
  async coinedLate(q: { readonly lateMs: number; readonly deployerWindowMs: number; readonly deployerMinPosts: number }): Promise<ReadonlyMap<string, { readonly coins: number; readonly firstLateAt: Date }>> {
    const rows = await orNone(() => this.#db.query<{ item_id: string; coins: number; first_late_at: Date }>(
      `with linked as (
         select l.source || ':' || l.source_item_id as item_id, l.address, l.minted_at,
                lower(substring(l.link from '/([A-Za-z0-9_]+)/status')) as handle
           from internal.coin_post_link l where l.minted_at is not null
         union
         select cur.item_id, cur.coin_address, coalesce(a.minted_at, n.launched_at), null
           from (${CURRENT_COIN_CALLS}) cur
           left join public.asset a on a.address = cur.coin_address
           left join public.coin_name n on n.address = cur.coin_address
          where cur.verdict = 'right' and cur.coin_address is not null
       ),
       timed as (
         select k.item_id, k.address, k.minted_at, k.handle, i.author_key,
                coalesce(i.posted_at, case when k.item_id like 'x:%' then to_timestamp(((split_part(k.item_id, ':', 2)::bigint >> 22) + 1288834974657) / 1000.0) end) as posted_at
           from linked k left join public.item i on i.item_id = k.item_id
          where k.minted_at is not null and split_part(k.item_id, ':', 2) ~ '^[0-9]{8,19}$'
       ),
       quick as (
         select item_id, author_key, handle from timed
          where minted_at >= posted_at and minted_at < posted_at + make_interval(secs => $2::double precision / 1000)
       ),
       launchers as (
         select 'a' as by, author_key as who from quick where author_key is not null group by author_key having count(distinct item_id) >= $3
         union all
         select 'h', handle from quick where handle is not null and handle <> 'i' group by handle having count(distinct item_id) >= $3
       ),
       coined as (
         select item_id,
                count(distinct address) filter (where minted_at >= posted_at + make_interval(secs => $1::double precision / 1000))::int as coins,
                min(minted_at) filter (where minted_at >= posted_at + make_interval(secs => $1::double precision / 1000)) as first_late_at,
                array_remove(array_agg(distinct author_key), null) as authors, array_remove(array_agg(distinct handle), null) as handles
           from timed where posted_at is not null group by item_id
       )
       select item_id, coins, first_late_at from coined c
        where c.coins >= 1
          and not exists (select 1 from launchers d where (d.by = 'a' and d.who = any(c.authors)) or (d.by = 'h' and d.who = any(c.handles)))`,
      [q.lateMs, q.deployerWindowMs, q.deployerMinPosts],
    ));
    return new Map(rows.map((r) => [r.item_id, { coins: Number(r.coins), firstLateAt: r.first_late_at }] as const));
  }

  /** The held posts among these, with when we first saw them and their own first live answer, if any. */
  async held(itemIds: readonly string[]): Promise<ReadonlyMap<string, { readonly firstSeenAt: Date; readonly firstAnswerAt: Date | null }>> {
    if (itemIds.length === 0) return new Map();
    const rows = await this.#db.query<{ item_id: string; first_seen_at: Date; answered: Date | null }>(
      `select i.item_id, i.first_seen_at,
              (select min(judged_at) from internal.post_judgement j where j.item_id = i.item_id and j.prompt_id not like 'post-kind%' and j.judge_id not like 'rule:%' and j.copied_from is null) as answered
         from public.item i where i.item_id = any($1::text[])`,
      [[...itemIds]],
    );
    return new Map(rows.map((r) => [r.item_id, { firstSeenAt: r.first_seen_at, firstAnswerAt: r.answered }] as const));
  }

  /** Every reach reading of these posts, oldest first: the For You reach bar, replayed. */
  async reachReadings(itemIds: readonly string[]): Promise<ReadonlyMap<string, readonly { readonly atMs: number; readonly reach: number | null }[]>> {
    const out = new Map<string, { atMs: number; reach: number | null }[]>();
    if (itemIds.length === 0) return out;
    const rows = await this.#db.query<{ item_id: string; captured_at: Date; value: number | null }>(
      `select item_id, captured_at, value from public.observation where kind = 'reach' and item_id = any($1::text[]) order by item_id, captured_at`,
      [[...itemIds]],
    );
    for (const r of rows) {
      const list = out.get(r.item_id) ?? [];
      list.push({ atMs: r.captured_at.getTime(), reach: r.value === null ? null : Number(r.value) });
      out.set(r.item_id, list);
    }
    return out;
  }

  /** Each post's highest reach reading ever, with when it first went over `share` of its source's line: the viral target's label. */
  async reachPeaks(itemIds: readonly string[], lines: Readonly<Record<string, number>>, share: number): Promise<ReadonlyMap<string, { readonly top: number; readonly earlyAt: Date | null; readonly crossedAt: Date | null }>> {
    if (itemIds.length === 0) return new Map();
    const rows = await this.#db.query<{ item_id: string; top: number; early_at: Date | null; crossed_at: Date | null }>(
      `with l as (select * from unnest($2::text[], $3::float8[]) as l(source, line))
       select o.item_id, max(o.value) as top,
              min(o.captured_at) filter (where o.value >= $4::float8 * l.line) as early_at,
              min(o.captured_at) filter (where o.value >= l.line) as crossed_at
         from public.observation o join public.item i on i.item_id = o.item_id left join l on l.source = i.source
        where o.kind = 'reach' and o.value is not null and o.item_id = any($1::text[])
        group by o.item_id`,
      [[...itemIds], Object.keys(lines), Object.values(lines), share],
    );
    return new Map(rows.map((r) => [r.item_id, { top: Number(r.top), earlyAt: r.early_at, crossedAt: r.crossed_at }] as const));
  }

  /** The newest post-question answer of two old judges, by judge id pattern: the junk labels' inputs. */
  async oldAnswers(itemIds: readonly string[], patterns: readonly [string, string]): Promise<ReadonlyMap<string, { readonly a: { coinable: boolean; confidence: number } | null; readonly b: { coinable: boolean; confidence: number } | null }>> {
    const out = new Map<string, { a: { coinable: boolean; confidence: number } | null; b: { coinable: boolean; confidence: number } | null }>();
    if (itemIds.length === 0) return out;
    const rows = await this.#db.query<{ item_id: string; which: string; coinable: boolean; confidence: number }>(
      `select distinct on (item_id, which) item_id, case when judge_id like $2 then 'a' else 'b' end as which, coinable, confidence
         from internal.post_judgement
        where item_id = any($1::text[]) and prompt_id not like 'post-kind%' and (judge_id like $2 or judge_id like $3)
        order by item_id, which, judged_at desc, id desc`,
      [[...itemIds], patterns[0], patterns[1]],
    );
    for (const r of rows) {
      const was = out.get(r.item_id) ?? { a: null, b: null };
      was[r.which === 'a' ? 'a' : 'b'] = { coinable: r.coinable, confidence: Number(r.confidence) };
      out.set(r.item_id, was);
    }
    return out;
  }

  /** When each of these posts first went on a feed, null when never. */
  async firstShown(feedId: string, itemIds: readonly string[]): Promise<ReadonlyMap<string, Date>> {
    if (itemIds.length === 0) return new Map();
    const rows = await this.#db.query<{ item_id: string; first_shown_at: Date }>(
      `select item_id, first_shown_at from public.feed_post where feed_id = $1 and item_id = any($2::text[])`,
      [feedId, [...itemIds]],
    );
    return new Map(rows.map((r) => [r.item_id, r.first_shown_at] as const));
  }

  /** Every post first shown on a feed in [from, to): the judge-alone side of the junk measure. */
  async shownBetween(feedId: string, from: Date, to: Date): Promise<readonly string[]> {
    const rows = await this.#db.query<{ item_id: string }>(
      `select item_id from public.feed_post where feed_id = $1 and first_shown_at >= $2 and first_shown_at < $3`,
      [feedId, from, to],
    );
    return rows.map((r) => r.item_id);
  }

  /* ── the fits ─────────────────────────────────────────────────────────────────────────────── */

  /**
   * The read or write as 0099 has it, or, before 0099 is applied, as 0096 had it for the coined
   * target (every row then was coined); another target before 0099 is "no fit".
   */
  async #byTarget<R>(target: CoinModelTarget, withTarget: () => Promise<R>, before0099: () => Promise<R>): Promise<R> {
    try {
      return await withTarget();
    } catch (e) {
      if (target === 'coined' && isMissingColumn(e)) return before0099();
      throw e;
    }
  }

  /** The fit the runner scores this target with, or null: none applied, or 0096 (or, for a target but coined, 0099) not applied here yet. */
  async latestApplied(target: CoinModelTarget): Promise<AppliedCoinModel | null> {
    return this.#latest(target, true);
  }

  /**
   * The fit a SHADOWED target scores with: its newest fit with a threshold, applied or not. A shadow
   * score is a log and lets nothing onto For You, so the gate that decides `applied` (whether the
   * fit may ever act) does not decide whether it may be watched; the live target scores with
   * `latestApplied` only.
   */
  async latestForShadow(target: CoinModelTarget): Promise<AppliedCoinModel | null> {
    return this.#latest(target, false);
  }

  async #latest(target: CoinModelTarget, appliedOnly: boolean): Promise<AppliedCoinModel | null> {
    const read = (withTarget: boolean) => () => this.#db.query<Record<string, unknown>>(
      `select id, ${withTarget ? 'target' : `'coined' as target`}, fitted_at, space, intercept, names, means, spreads, weights, vector_weights, threshold, held_out
         from internal.coin_model where ${appliedOnly ? 'applied and ' : ''}threshold is not null${withTarget ? ' and target = $1' : ''}
        order by ${appliedOnly ? 'applied_at desc, ' : ''}fitted_at desc, id desc limit 1`,
      withTarget ? [target] : [],
    );
    const rows = await orNone(() => this.#byTarget(target, read(true), read(false)));
    const r = rows[0];
    if (r === undefined) return null;
    const nums = (k: string): number[] => ((r[k] as unknown[]) ?? []).map(Number);
    return {
      id: Number(r['id']), target: r['target'] === 'viral' || r['target'] === 'memeable' ? r['target'] : 'coined', fittedAt: r['fitted_at'] as Date, space: String(r['space']), intercept: Number(r['intercept']),
      names: (r['names'] as string[]) ?? [], means: nums('means'), spreads: nums('spreads'), weights: nums('weights'), vectorWeights: nums('vector_weights'),
      threshold: Number(r['threshold']), heldOut: (r['held_out'] as Record<string, unknown>) ?? {},
    };
  }

  /** Writes one fit; null before 0096, or before 0099 for a target but coined. */
  async record(f: CoinModelFitRow): Promise<number | null> {
    const write = (withTarget: boolean) => () => this.#db.query<{ id: string }>(
      `insert into internal.coin_model (fitted_at, space, intercept, names, means, spreads, weights, vector_weights, threshold, fit_n, held_out, applied, applied_at, why${withTarget ? ', target' : ''})
       values ($1, $2, $3, $4::text[], $5::double precision[], $6::double precision[], $7::double precision[], $8::double precision[], $9, $10, $11::jsonb, $12, $13, $14${withTarget ? ', $15' : ''}) returning id`,
      [f.fittedAt, f.space, f.intercept, [...f.names], [...f.means], [...f.spreads], [...f.weights], [...f.vectorWeights], f.threshold, f.fitN, JSON.stringify(f.heldOut), f.applied, f.applied ? f.fittedAt : null, f.why, ...(withTarget ? [f.target] : [])],
    );
    try {
      const rows = await this.#byTarget(f.target, write(true), write(false));
      return Number(rows[0]?.id);
    } catch (e) {
      if (isMissingTable(e)) return null;
      throw e;
    }
  }

  /* ── the scores ───────────────────────────────────────────────────────────────────────────── */

  /**
   * Posts whose newest live answer is "no", answered since `since`, never scored for `target`:
   * newest answer first, at most `limit`. A post re-answered "yes" later drops out by itself.
   */
  async toScore(since: Date, limit: number, target: CoinModelTarget, everyPost = false): Promise<readonly ToScore[]> {
    if (everyPost) return this.#toScoreEvery(since, limit, target);
    const read = (withTarget: boolean) => () => this.#db.query<{ item_id: string; judged_at: Date }>(
      `select n.item_id, n.judged_at from (
         select distinct on (item_id) item_id, judged_at, coinable from internal.post_judgement
          where judged_at >= $1 and prompt_id not like 'post-kind%' and judge_id not like 'rule:%' and copied_from is null
          order by item_id, judged_at desc, id desc
       ) n
       join public.item i on i.item_id = n.item_id
       where not n.coinable and not exists (select 1 from internal.coin_model_score s where s.item_id = n.item_id${withTarget ? ' and s.target = $3' : ''})
       order by n.judged_at desc limit $2`,
      withTarget ? [since, limit, target] : [since, limit],
    );
    const rows = await orNone(() => this.#byTarget(target, read(true), read(false)));
    return rows.map((r) => ({ itemId: r.item_id, answerJudgedAt: r.judged_at }));
  }

  /**
   * Every post with a live answer since `since`, whatever it said, never scored for `target`: as of
   * its FIRST live answer, the moment the judge decided it and the moment the side-by-side compares.
   * Newest first, at most `limit`. A target scored this way is one the judge is read beside
   * (Policy.judge.coinModel.everyPost); it needs 0099, so before it there is nothing to score.
   */
  async #toScoreEvery(since: Date, limit: number, target: CoinModelTarget): Promise<readonly ToScore[]> {
    const rows = await orNone(() => this.#db.query<{ item_id: string; judged_at: Date }>(
      `select f.item_id, f.judged_at from (
         select distinct on (item_id) item_id, judged_at from internal.post_judgement
          where judged_at >= $1 and prompt_id not like 'post-kind%' and judge_id not like 'rule:%' and copied_from is null
          order by item_id, judged_at asc, id asc
       ) f
       join public.item i on i.item_id = f.item_id
       where not exists (select 1 from internal.coin_model_score s where s.item_id = f.item_id and s.target = $3)
       order by f.judged_at desc limit $2`,
      [since, limit, target],
    ));
    return rows.map((r) => ({ itemId: r.item_id, answerJudgedAt: r.judged_at }));
  }

  /** Records scores, once per post and target. Before 0099 only coined scores can be written. */
  async recordScores(rows: readonly CoinModelScore[]): Promise<void> {
    if (rows.length === 0) return;
    const write = (withTarget: boolean) => async (): Promise<void> => {
      await this.#db.query(
        `insert into internal.coin_model_score (item_id, fit_id, probability, threshold, would_add, answer_judged_at, scored_at, mode${withTarget ? ', target' : ''})
         select * from unnest($1::text[], $2::bigint[], $3::double precision[], $4::double precision[], $5::boolean[], $6::timestamptz[], $7::timestamptz[], $8::text[]${withTarget ? ', $9::text[]' : ''})
         on conflict (item_id${withTarget ? ', target' : ''}) do nothing`,
        [rows.map((r) => r.itemId), rows.map((r) => r.fitId), rows.map((r) => r.probability), rows.map((r) => r.threshold), rows.map((r) => r.wouldAdd), rows.map((r) => r.answerJudgedAt), rows.map((r) => r.scoredAt), rows.map((r) => r.mode), ...(withTarget ? [rows.map((r) => r.target)] : [])],
      );
    };
    await this.#byTarget(rows.every((r) => r.target === 'coined') ? 'coined' : 'viral', write(true), write(false));
  }

  /** Every score of `target` written since `since`: the shadow report's input. */
  async scoresSince(since: Date, target: CoinModelTarget): Promise<readonly CoinModelScore[]> {
    const read = (withTarget: boolean) => () => this.#db.query<{ item_id: string; fit_id: string; probability: number; threshold: number; would_add: boolean; answer_judged_at: Date; scored_at: Date; mode: string }>(
      `select item_id, fit_id, probability, threshold, would_add, answer_judged_at, scored_at, mode from internal.coin_model_score where scored_at >= $1${withTarget ? ' and target = $2' : ''} order by scored_at`,
      withTarget ? [since, target] : [since],
    );
    const rows = await orNone(() => this.#byTarget(target, read(true), read(false)));
    return rows.map((r) => ({ itemId: r.item_id, target, fitId: Number(r.fit_id), probability: Number(r.probability), threshold: Number(r.threshold), wouldAdd: r.would_add, answerJudgedAt: r.answer_judged_at, scoredAt: r.scored_at, mode: r.mode === 'live' ? 'live' : 'shadow' }));
  }
}
