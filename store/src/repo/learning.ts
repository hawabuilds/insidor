/**
 * The judge's learning, as rows: every learned-examples block built and how it tested (0056), the
 * scheduled re-tunes that built them, the gold set's live additions (0057), and the reads of the
 * owner's own input the re-tune learns from.
 *
 * Its own repository because these rows teach the judge rather than record the world: the runner
 * reads exactly one thing here (the latest APPLIED block), and nothing a surface shows comes from
 * it. Keeping the re-tune's reads in one file also keeps "what counts as new since the last run"
 * in one place — the skip and the build must agree on which inputs exist.
 *
 * ★ A TABLE NOT YET MIGRATED IS "NOTHING APPLIED". The runner may deploy before 0056 is applied;
 * `latestApplied` then answers null (the judge's rules alone) instead of failing the boot or the
 * five-minute check. Only an undefined table is read that way — any other error still throws.
 *
 * What breaks if changed carelessly: `latestApplied` filters on `applied`. Reading the latest row
 * instead would put a block that FAILED its gates in front of the live judge.
 */

import type { Db } from '../client.ts';

export interface AppliedExamples {
  readonly versionId: number;
  readonly text: string;
  readonly sha: string;
  readonly appliedAt: Date;
}

export interface ExamplesVersion {
  readonly builtAt: Date;
  readonly text: string;
  readonly sha: string;
  readonly exampleIds: readonly string[];
  readonly tapsUsed: number;
  readonly missedUsed: number;
  readonly labelsUsed: number;
  readonly namesUsed: number;
  readonly inputsThrough: Date | null;
  readonly labelsSha: string;
  readonly goldPass: number | null;
  readonly goldN: number;
  readonly liveNegativePass: number | null;
  readonly liveNegativeN: number;
  readonly missedPass: number | null;
  readonly missedN: number;
  readonly applied: boolean;
  readonly reasonNotApplied: string | null;
  readonly dry: boolean;
  readonly costUsd: number;
}

export type RetuneOutcome = 'skipped' | 'kept' | 'applied' | 'dry' | 'failed';

export interface GoldAddition {
  readonly itemId: string;
  readonly source: 'recall' | 'missed';
  readonly coinMint: string;
  readonly coinName: string | null;
  readonly postText: string;
  readonly imageUri: string | null;
  readonly postedAt: Date | null;
  readonly launchedAt: Date | null;
  readonly addedOn: string;
}

/** A recall-check coin whose creator linked an X post made before launch, with the post as we hold it. */
export interface RecallOrigin {
  readonly mint: string;
  readonly coinName: string | null;
  readonly postId: string;
  readonly postedAt: Date | null;
  readonly launchedAt: Date | null;
  /** From public.item when we held the post; null when we never did. */
  readonly body: string | null;
  readonly media: unknown;
}

export class PgLearningRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** The block the live judge reads, or null: no block (the judge's rules alone). */
  async latestApplied(): Promise<AppliedExamples | null> {
    const rows = await orNoTable(() =>
      this.#db.query<{ version_id: string; text: string; sha: string; applied_at: Date }>(
        'select version_id, text, sha, applied_at from internal.judge_examples_version where applied order by applied_at desc limit 1',
      ),
    );
    const r = rows[0];
    return r === undefined ? null : { versionId: Number(r.version_id), text: r.text, sha: r.sha, appliedAt: r.applied_at };
  }

  /** The newest block built (applied or not): what a new run compares its inputs against. */
  async lastBuilt(): Promise<{ readonly versionId: number; readonly inputsThrough: Date | null; readonly labelsSha: string; readonly exampleIds: readonly string[] } | null> {
    const rows = await this.#db.query<{ version_id: string; inputs_through: Date | null; labels_sha: string; example_ids: string[] }>(
      'select version_id, inputs_through, labels_sha, example_ids from internal.judge_examples_version order by built_at desc limit 1',
    );
    const r = rows[0];
    return r === undefined ? null : { versionId: Number(r.version_id), inputsThrough: r.inputs_through, labelsSha: r.labels_sha, exampleIds: r.example_ids };
  }

  /** The example ids of the block the judge reads now, for "what changed". Empty with none. */
  async appliedExampleIds(): Promise<readonly string[]> {
    const rows = await this.#db.query<{ example_ids: string[] }>('select example_ids from internal.judge_examples_version where applied order by applied_at desc limit 1');
    return rows[0]?.example_ids ?? [];
  }

  async recordVersion(v: ExamplesVersion): Promise<number> {
    const rows = await this.#db.query<{ version_id: string }>(
      `insert into internal.judge_examples_version
         (built_at, text, sha, example_ids, taps_used, missed_used, labels_used, names_used, inputs_through, labels_sha,
          gold_pass, gold_n, live_negative_pass, live_negative_n, missed_pass, missed_n, applied, applied_at, reason_not_applied, dry, cost_usd)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
       returning version_id`,
      [
        v.builtAt, v.text, v.sha, [...v.exampleIds], v.tapsUsed, v.missedUsed, v.labelsUsed, v.namesUsed, v.inputsThrough, v.labelsSha,
        v.goldPass, v.goldN, v.liveNegativePass, v.liveNegativeN, v.missedPass, v.missedN, v.applied, v.applied ? v.builtAt : null, v.reasonNotApplied, v.dry, v.costUsd,
      ],
    );
    return Number(rows[0]?.version_id);
  }

  /** Takes the slot; false when another run already has it. Before any money is spent. */
  async claimSlot(slot: Date, startedAt: Date): Promise<boolean> {
    const rows = await this.#db.query(
      "insert into internal.judge_retune (slot, started_at, outcome) values ($1, $2, 'running') on conflict (slot) do nothing returning 1",
      [slot, startedAt],
    );
    return rows.length > 0;
  }

  /** Whether this slot has a run (in any state). */
  async hasRun(slot: Date): Promise<boolean> {
    return (await this.#db.query('select 1 from internal.judge_retune where slot = $1', [slot])).length > 0;
  }

  async endRun(slot: Date, end: { readonly outcome: RetuneOutcome; readonly versionId: number | null; readonly detail: string | null; readonly costUsd: number | null; readonly endedAt: Date }): Promise<void> {
    await this.#db.query('update internal.judge_retune set ended_at = $2, outcome = $3, version_id = $4, detail = $5, cost_usd = $6 where slot = $1', [
      slot, end.endedAt, end.outcome, end.versionId, end.detail, end.costUsd,
    ]);
  }

  async recentRuns(limit: number): Promise<readonly { slot: Date; outcome: string; detail: string | null; costUsd: number | null; versionId: number | null }[]> {
    const rows = await this.#db.query<{ slot: Date; outcome: string; detail: string | null; cost_usd: number | null; version_id: string | null }>(
      'select slot, outcome, detail, cost_usd, version_id from internal.judge_retune order by slot desc limit $1',
      [limit],
    );
    return rows.map((r) => ({ slot: r.slot, outcome: r.outcome, detail: r.detail, costUsd: r.cost_usd, versionId: r.version_id === null ? null : Number(r.version_id) }));
  }

  /* ── gold from live ─────────────────────────────────────────────────────────────────────── */

  async goldAdditions(): Promise<readonly GoldAddition[]> {
    const rows = await this.#db.query<{ item_id: string; source: 'recall' | 'missed'; coin_mint: string; coin_name: string | null; post_text: string; image_uri: string | null; posted_at: Date | null; launched_at: Date | null; added_on: string }>(
      "select item_id, source, coin_mint, coin_name, post_text, image_uri, posted_at, launched_at, to_char(added_on, 'YYYY-MM-DD') as added_on from internal.gold_addition order by added_at",
    );
    return rows.map((r) => ({ itemId: r.item_id, source: r.source, coinMint: r.coin_mint, coinName: r.coin_name, postText: r.post_text, imageUri: r.image_uri, postedAt: r.posted_at, launchedAt: r.launched_at, addedOn: r.added_on }));
  }

  /** Adds each post once; a post already in gold is left as it was. Returns how many were new. */
  async addGold(rows: readonly GoldAddition[], at: Date): Promise<number> {
    let added = 0;
    for (const g of rows) {
      const r = await this.#db.query(
        `insert into internal.gold_addition (item_id, source, coin_mint, coin_name, post_text, image_uri, posted_at, launched_at, added_on, added_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10) on conflict (item_id) do nothing returning 1`,
        [g.itemId, g.source, g.coinMint, g.coinName, g.postText, g.imageUri, g.postedAt, g.launchedAt, g.addedOn, at],
      );
      added += r.length;
    }
    return added;
  }

  /**
   * The recall check's coins of the last `days` whose creator linked an X post made before the
   * coin launched, not yet in gold, with the post's text and media when public.item held it.
   */
  async recallOrigins(days: number): Promise<readonly RecallOrigin[]> {
    const rows = await this.#db.query<{ mint: string; coin_name: string | null; post_id: string; posted_at: Date | null; launched_at: Date | null; body: string | null; media: unknown }>(
      `select distinct on (r.post_id) r.mint, r.coin_name, r.post_id, r.posted_at, r.launched_at, i.body, i.media
         from internal.recall_check r
         left join public.item i on i.item_id = 'x:' || r.post_id
        where r.day >= current_date - $1::int
          and r.post_platform = 'x'
          and r.launched_at is not null
          and (r.posted_at is null or r.posted_at <= r.launched_at)
          and r.miss_reason is distinct from 'posted_after_launch'
          and not exists (select 1 from internal.gold_addition g where g.item_id = 'x:' || r.post_id)
        order by r.post_id, r.day desc`,
      [days],
    );
    return rows.map((r) => ({ mint: r.mint, coinName: r.coin_name, postId: r.post_id, postedAt: r.posted_at, launchedAt: r.launched_at, body: r.body, media: r.media }));
  }

  /**
   * Every coined picture's vector, for the picture boost the projector applies — read here so the
   * re-tune's test grades posts exactly as the feed would, without a second repo to wire.
   */
  async coinedPictureVectors(): Promise<readonly { readonly coinRef: string; readonly uri: string; readonly v: readonly number[] }[]> {
    const rows = await this.#db.query<{ coin_ref: string; uri: string; embedding: string }>('select coin_ref, uri, embedding::text as embedding from internal.coined_picture');
    return rows.map((r) => ({ coinRef: r.coin_ref, uri: r.uri, v: JSON.parse(r.embedding) as number[] }));
  }

  /* ── the owner's input (0054 owner_feedback, 0055 missed_post) ───────────────────────────────── */

  /**
   * The newest owner input of any kind: a call from the phone, a missed post read, a gold addition.
   * Null when there has never been any. A re-tune with nothing newer than its last block skips.
   */
  async newestInput(): Promise<Date | null> {
    const rows = await this.#db.query<{ at: Date | null }>(
      `select greatest(
         (select max(created_at) from internal.owner_feedback),
         (select max(coalesce(checked_at, added_at)) from internal.missed_post where status = 'done'),
         (select max(added_at) from internal.gold_addition)) as at`,
    );
    return rows[0]?.at ?? null;
  }

  /**
   * The owner's current call on each post ('meme' or 'not'), newest row per post, with the post's
   * text and media as we hold them — or, for a post that aged out, as it was on the owner's screen.
   */
  async postCalls(): Promise<readonly OwnerPostCall[]> {
    const rows = await this.#db.query<{ item_id: string; verdict: 'meme' | 'not'; note: string | null; created_at: Date; body: string | null; media: unknown; shown: Record<string, unknown> | null }>(
      `select f.item_id, f.verdict, f.note, f.created_at, i.body, i.media, f.shown
         from (select distinct on (item_id) item_id, verdict, note, created_at, shown
                 from internal.owner_feedback where subject_kind = 'post'
                order by item_id, created_at desc, id desc) f
         left join public.item i on i.item_id = f.item_id`,
    );
    return rows.map((r) => ({ itemId: r.item_id, verdict: r.verdict, note: r.note, at: r.created_at, body: r.body ?? shownText(r.shown), media: r.media, shownPicture: shownPicture(r.shown) }));
  }

  /** The owner's current call on each suggested name (and their own better name), with the post's text. */
  async nameCalls(): Promise<readonly OwnerNameCall[]> {
    const rows = await this.#db.query<{ item_id: string; verdict: 'up' | 'down'; name: string; better_name: string | null; created_at: Date; body: string | null; shown: Record<string, unknown> | null }>(
      `select f.item_id, f.verdict, f.name, f.better_name, f.created_at, i.body, f.shown
         from (select distinct on (item_id, name) item_id, verdict, name, better_name, created_at, shown
                 from internal.owner_feedback where subject_kind = 'name'
                order by item_id, name, created_at desc, id desc) f
         left join public.item i on i.item_id = f.item_id`,
    );
    return rows.map((r) => ({ itemId: r.item_id, verdict: r.verdict, name: r.name, betterName: r.better_name, at: r.created_at, body: r.body ?? shownText(r.shown) }));
  }

  /** The owner's current call on each coin match: right, wrong (with the coin they say it is) or none. */
  async matchCalls(): Promise<readonly { readonly itemId: string; readonly verdict: 'right' | 'wrong' | 'none'; readonly coinAddress: string | null; readonly note: string | null; readonly at: Date }[]> {
    const rows = await this.#db.query<{ item_id: string; verdict: 'right' | 'wrong' | 'none'; coin_address: string | null; note: string | null; created_at: Date }>(
      `select distinct on (item_id) item_id, verdict, coin_address, note, created_at
         from internal.owner_feedback where subject_kind = 'coin_match'
        order by item_id, created_at desc, id desc`,
    );
    return rows.map((r) => ({ itemId: r.item_id, verdict: r.verdict, coinAddress: r.coin_address, note: r.note, at: r.created_at }));
  }

  /** The owner's missed posts that were read (`done`): each a "yes", with its post and diagnosis. */
  async missedPosts(): Promise<readonly MissedPost[]> {
    const rows = await this.#db.query<{ item_id: string; diagnosis: string; at: Date; body: string; media: unknown; posted_at: Date | null; coin_address: string | null; first_coin_at: Date | null }>(
      `select m.item_id, m.diagnosis, coalesce(m.checked_at, m.added_at) as at, i.body, i.media, coalesce(m.posted_at, i.posted_at) as posted_at, m.coin_address, m.first_coin_at
         from internal.missed_post m join public.item i on i.item_id = m.item_id
        where m.status = 'done'`,
    );
    return rows.map((r) => ({ itemId: r.item_id, diagnosis: r.diagnosis, at: r.at, body: r.body, media: r.media, postedAt: r.posted_at, coinAddress: r.coin_address, firstCoinAt: r.first_coin_at }));
  }

  /** Why the owner's missed posts read since `since` were missed, counted by diagnosis. */
  async missReasons(since: Date): Promise<Readonly<Record<string, number>>> {
    const rows = await this.#db.query<{ diagnosis: string; n: string }>(
      `select diagnosis, count(*) as n from internal.missed_post
        where diagnosis is not null and coalesce(checked_at, added_at) >= $1 group by diagnosis order by count(*) desc`,
      [since],
    );
    return Object.fromEntries(rows.map((r) => [r.diagnosis, Number(r.n)]));
  }
}

export interface OwnerPostCall {
  readonly itemId: string;
  readonly verdict: 'meme' | 'not';
  readonly note: string | null;
  readonly at: Date;
  /** public.item's body, or the card text the owner saw; null when neither is known. */
  readonly body: string | null;
  readonly media: unknown;
  readonly shownPicture: string | null;
}

export interface OwnerNameCall {
  readonly itemId: string;
  readonly verdict: 'up' | 'down';
  readonly name: string;
  readonly betterName: string | null;
  readonly at: Date;
  readonly body: string | null;
}

export interface MissedPost {
  readonly itemId: string;
  readonly diagnosis: string;
  readonly at: Date;
  readonly body: string;
  readonly media: unknown;
  readonly postedAt: Date | null;
  /** The one coin of its name found after it; null when none, or several (never a pick). */
  readonly coinAddress: string | null;
  readonly firstCoinAt: Date | null;
}

/** Postgres's "undefined table": the migration that makes it has not been applied here yet. */
const UNDEFINED_TABLE = '42P01';
export const isMissingTable = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === UNDEFINED_TABLE;
async function orNoTable<R>(read: () => Promise<R[]>): Promise<R[]> {
  try {
    return await read();
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
}

/* What the owner's screen showed, as the client sent it: read for display context only. */
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const shownText = (shown: Record<string, unknown> | null): string | null => (shown === null ? null : (str(shown['text']) ?? str(shown['body'])));
const shownPicture = (shown: Record<string, unknown> | null): string | null => (shown === null ? null : (str(shown['imageUri']) ?? str(shown['picture']) ?? str(shown['image'])));
