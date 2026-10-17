/**
 * The judge's learning, as rows: every learned-examples block built and how it tested (0056), the
 * scheduled re-tunes that built them, the gold set's live additions (0057), the posts on the
 * owner's hand-gold list, and the reads of the owner's own input the re-tune learns from.
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
 * ★ AND A COLUMN NOT YET MIGRATED IS "NO CUTOFF". The applied block's own yes/no cutoff (0086,
 * `judge_cutoff`) is read when the column exists and is null otherwise, so the runner and the
 * projector work before 0086: the judge is then held to the policy bar, as before. A block whose
 * cutoff could not be stored must not be applied — `hasJudgeCutoff` is how the re-tune knows.
 *
 * What breaks if changed carelessly: `latestApplied` filters on `applied`. Reading the latest row
 * instead would put a block that FAILED its gates in front of the live judge.
 */

import type { Db } from '../client.ts';
import { CURRENT_COIN_CALLS } from './owner-coin-calls.ts';

export interface AppliedExamples {
  readonly versionId: number;
  readonly text: string;
  readonly sha: string;
  readonly appliedAt: Date;
  /** The yes/no cutoff applied with this block (0086); null: the policy bar. */
  readonly cutoff: number | null;
  /** The judge (`judge:<vendor>/<model>`) the cutoff was chosen on (0094); null: not recorded. */
  readonly cutoffModel: string | null;
}

const UNDEFINED_COLUMN = '42703';
const isMissingColumn = (e: unknown): boolean => (e as { code?: unknown } | null)?.code === UNDEFINED_COLUMN;

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
  /** The yes/no cutoff applied with the block (0086); null or absent: the policy bar. Needs `hasJudgeCutoff`. */
  readonly judgeCutoff?: number | null;
  /** The judge the cutoff was chosen on (0094); written only with a cutoff and only once 0094 is applied (`hasCutoffModel`). */
  readonly judgeCutoffModel?: string | null;
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
    type Row = { version_id: string; text: string; sha: string; applied_at: Date; extra: { judge_cutoff?: string | number | null; judge_cutoff_model?: string | null } | null };
    /* ★ THE NEWER COLUMNS AS JSON (0086's cutoff, 0094's model): absent before their migration, and
       never an error — a missing column named in the select would abort a caller's transaction (a
       read-only tool reading inside one did, 2026-10-17), and a retry inside it cannot run. */
    const rows = await orNoTable(() =>
      this.#db.query<Row>(
        `select v.version_id, v.text, v.sha, v.applied_at, to_jsonb(v) - 'text' - 'example_ids' as extra
           from internal.judge_examples_version v where v.applied order by v.applied_at desc limit 1`,
      ),
    );
    const r = rows[0];
    const raw = r?.extra?.judge_cutoff;
    const cutoff = raw === undefined || raw === null ? null : Number(raw);
    const model = r?.extra?.judge_cutoff_model;
    const cutoffModel = cutoff === null || model === undefined || model === null ? null : model;
    return r === undefined ? null : { versionId: Number(r.version_id), text: r.text, sha: r.sha, appliedAt: r.applied_at, cutoff, cutoffModel };
  }

  /** Whether a block's own cutoff can be stored (0086 applied). */
  async hasJudgeCutoff(): Promise<boolean> {
    try {
      await this.#db.query('select judge_cutoff from internal.judge_examples_version limit 0');
      return true;
    } catch (e) {
      if (isMissingColumn(e)) return false;
      throw e;
    }
  }

  /** Whether the model a cutoff was chosen on can be stored with it (0094 applied). */
  async hasCutoffModel(): Promise<boolean> {
    try {
      await this.#db.query('select judge_cutoff_model from internal.judge_examples_version limit 0');
      return true;
    } catch (e) {
      if (isMissingColumn(e)) return false;
      throw e;
    }
  }

  /**
   * The newest block built for real (applied or kept, not a dry run): what a new run compares its
   * inputs against. A dry run is left out, so a block only measured by hand is still built and
   * tested at the next slot rather than skipped as "nothing new".
   */
  async lastBuilt(): Promise<{ readonly versionId: number; readonly inputsThrough: Date | null; readonly labelsSha: string; readonly exampleIds: readonly string[] } | null> {
    const rows = await this.#db.query<{ version_id: string; inputs_through: Date | null; labels_sha: string; example_ids: string[] }>(
      'select version_id, inputs_through, labels_sha, example_ids from internal.judge_examples_version where not dry order by built_at desc limit 1',
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
    /* The cutoff column only when there is a cutoff, so a run before 0086 still records its block. */
    const withCutoff = v.judgeCutoff !== undefined && v.judgeCutoff !== null;
    /* Its model only with it, and only when given: a caller that has not seen 0094 applied passes none. */
    const withModel = withCutoff && v.judgeCutoffModel !== undefined && v.judgeCutoffModel !== null;
    const rows = await this.#db.query<{ version_id: string }>(
      `insert into internal.judge_examples_version
         (built_at, text, sha, example_ids, taps_used, missed_used, labels_used, names_used, inputs_through, labels_sha,
          gold_pass, gold_n, live_negative_pass, live_negative_n, missed_pass, missed_n, applied, applied_at, reason_not_applied, dry, cost_usd${withCutoff ? ', judge_cutoff' : ''}${withModel ? ', judge_cutoff_model' : ''})
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21${withCutoff ? ', $22' : ''}${withModel ? ', $23' : ''})
       returning version_id`,
      [
        v.builtAt, v.text, v.sha, [...v.exampleIds], v.tapsUsed, v.missedUsed, v.labelsUsed, v.namesUsed, v.inputsThrough, v.labelsSha,
        v.goldPass, v.goldN, v.liveNegativePass, v.liveNegativeN, v.missedPass, v.missedN, v.applied, v.applied ? v.builtAt : null, v.reasonNotApplied, v.dry, v.costUsd,
        ...(withCutoff ? [v.judgeCutoff] : []),
        ...(withModel ? [v.judgeCutoffModel] : []),
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

  /**
   * The crypto signal on each of these posts, from its crypto-attention read (internal.crypto_attention,
   * 0064): other accounts' coin talk (a cashtag, an address or "CA" in their replies or quotes), and
   * whether the post is a shill (its own text, or its author's own replies, names a coin). Only reads
   * that carry the own/others split count; a post with none is absent — no facts, the judge alone
   * decides. An early read (cut before the coin, `_cutAt`) is preferred over a later one, because
   * talk after a coin launched says the coin exists, not that people would coin the post.
   */
  async cryptoSignals(itemIds: readonly string[]): Promise<ReadonlyMap<string, { readonly others: boolean; readonly shill: boolean }>> {
    if (itemIds.length === 0) return new Map();
    const rows = await this.#db.query<{ item_id: string; split: Record<string, unknown> }>(
      `select distinct on (item_id) item_id, cashtags as split from internal.crypto_attention
        where item_id = any($1) and cashtags ? '_others'
        order by item_id, (cashtags ? '_cutAt') desc, read_at desc`,
      [[...itemIds]],
    );
    const talks = (t: unknown): boolean => {
      if (typeof t !== 'object' || t === null) return false;
      const o = t as { cashtags?: Record<string, number>; addresses?: number; ca?: number };
      return Object.keys(o.cashtags ?? {}).length > 0 || (o.addresses ?? 0) > 0 || (o.ca ?? 0) > 0;
    };
    return new Map(rows.map((r) => [r.item_id, { others: talks(r.split['_others']), shill: r.split['_postShill'] === true || talks(r.split['_own']) }] as const));
  }

  /**
   * The posts first shown on one feed (public.feed_post) since `since`, with the newest kind label
   * the live judge gave each (null: never asked). The owner's gate (Policy.learning.ownerGate) reads
   * its recent junk from these: which of them the owner tapped "Not a meme", and which are news or
   * text-only. Read-only; about a thousand rows for three days of For You (2026-10-17).
   */
  async shownSince(feedId: string, since: Date): Promise<readonly { readonly itemId: string; readonly firstShownAt: Date; readonly kind: string | null }[]> {
    const rows = await this.#db.query<{ item_id: string; first_shown_at: Date; kind_label: string | null }>(
      `select fp.item_id, fp.first_shown_at, k.kind_label
         from public.feed_post fp
         left join lateral (select pj.proposed_name as kind_label from internal.post_judgement pj
                             where pj.item_id = fp.item_id and pj.prompt_id like 'post-kind%'
                             order by pj.judged_at desc, pj.id desc limit 1) k on true
        where fp.feed_id = $1 and fp.first_shown_at >= $2
        order by fp.first_shown_at desc, fp.item_id`,
      [feedId, since],
    );
    return rows.map((r) => ({ itemId: r.item_id, firstShownAt: r.first_shown_at, kind: r.kind_label }));
  }

  /** Posts as we hold them, for the owner's hand-gold list: text and media, by feed id. */
  async heldPosts(itemIds: readonly string[]): Promise<readonly { readonly itemId: string; readonly body: string; readonly media: unknown }[]> {
    if (itemIds.length === 0) return [];
    const rows = await this.#db.query<{ item_id: string; body: string | null; media: unknown }>('select item_id, body, media from public.item where item_id = any($1)', [[...itemIds]]);
    return rows.flatMap((r) => (r.body === null || r.body.trim() === '' ? [] : [{ itemId: r.item_id, body: r.body, media: r.media }]));
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

  /**
   * The owner's current call on each coin match: right (with the coin), wrong or none. The owner's
   * pick after "Wrong coin" — `wrong` with the coin picked — is `right` with it, unless it takes back
   * a coin an earlier `right` named (owner-coin-calls.ts `CURRENT_COIN_CALLS`). A post whose newest
   * call is `cleared` ("Remove my label", 0072) has no call and is absent.
   */
  async matchCalls(): Promise<readonly { readonly itemId: string; readonly verdict: 'right' | 'wrong' | 'none'; readonly coinAddress: string | null; readonly note: string | null; readonly at: Date }[]> {
    const rows = await this.#db.query<{ item_id: string; verdict: 'right' | 'wrong' | 'none'; coin_address: string | null; note: string | null; created_at: Date }>(
      `select * from (${CURRENT_COIN_CALLS}) cur where verdict <> 'cleared'`,
    );
    return rows.map((r) => ({ itemId: r.item_id, verdict: r.verdict, coinAddress: r.coin_address, note: r.note, at: r.created_at }));
  }

  /**
   * The coins the owner's current `right` calls name (the pick after "Wrong coin" included) that are not in our coin list yet, newest
   * call first: the runner adds each (services/runner work/owner-coins.ts) so the post can show it.
   */
  async ownerCoinsNotHeld(limit: number): Promise<readonly string[]> {
    const rows = await this.#db.query<{ coin_address: string }>(
      `select coin_address from (${CURRENT_COIN_CALLS}) cur
       where verdict = 'right' and coin_address is not null
         and not exists (select 1 from public.asset a where a.address = cur.coin_address)
       group by coin_address
       order by max(created_at) desc
       limit $1`,
      [limit],
    );
    return rows.map((r) => r.coin_address);
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

  /**
   * Posts of one source that at least `minCoins` distinct coins were launched for `lateMs` or more
   * after the post, whose newest first-question answer from the judge is "no", with the post held.
   * A coin is one whose metadata names the post (internal.coin_post_link, 0083) or the owner's
   * current `right` call. Read for the re-tune's coined "yes" examples (eval examples.ts `coinedYes`).
   *
   * ★ AN ACCOUNT THAT COINS ITS OWN POSTS IS LEFT OUT. An author with `deployerMinPosts` or more
   * posts that a coin was launched for within `deployerWindowMs` of posting is a launcher, not a
   * post people coined; all its posts are dropped. The author is the held post's author, and the
   * handle in the coin's link for posts we never held, each counted on its own.
   *
   * The post time is the held post's, else the id's own time (an X-style id carries it); a coin
   * with no launch time is not counted. Newest post first.
   *
   * `anyAnswer` drops the "judge said no" condition: every coined post, whatever the judge answered
   * or if it never did — the junk filter's keep labels (tools/lib/junk-filter.ts).
   */
  async coinedPosts(q: { readonly source: string; readonly minCoins: number; readonly lateMs: number; readonly deployerWindowMs: number; readonly deployerMinPosts: number; readonly anyAnswer?: boolean }): Promise<readonly CoinedPostRow[]> {
    const rows = await orNoTable(() => this.#db.query<{ item_id: string; body: string; media: unknown; posted_at: Date; coins: number; first_late_at: Date; coinable: boolean | null; kind_label: string | null; names: string[] | null }>(
      `with linked as (
         select l.source || ':' || l.source_item_id as item_id, l.address, l.minted_at,
                lower(substring(l.link from '/([A-Za-z0-9_]+)/status')) as handle
           from internal.coin_post_link l where l.source = $1 and l.minted_at is not null
         union
         select cur.item_id, cur.coin_address, coalesce(a.minted_at, n.launched_at), null
           from (${CURRENT_COIN_CALLS}) cur
           left join public.asset a on a.address = cur.coin_address
           left join public.coin_name n on n.address = cur.coin_address
          where cur.verdict = 'right' and cur.coin_address is not null and split_part(cur.item_id, ':', 1) = $1
       ),
       timed as (
         select k.item_id, k.address, k.minted_at, k.handle, i.author_key,
                coalesce(i.posted_at, to_timestamp(((split_part(k.item_id, ':', 2)::bigint >> 22) + 1288834974657) / 1000.0)) as posted_at
           from linked k left join public.item i on i.item_id = k.item_id
          where k.minted_at is not null and split_part(k.item_id, ':', 2) ~ '^[0-9]{8,19}$'
       ),
       quick as (
         select item_id, author_key, handle from timed
          where minted_at >= posted_at and minted_at < posted_at + make_interval(secs => $4::double precision / 1000)
       ),
       launchers as (
         select 'a' as by, author_key as who from quick where author_key is not null group by author_key having count(distinct item_id) >= $5
         union all
         select 'h', handle from quick where handle is not null and handle <> 'i' group by handle having count(distinct item_id) >= $5
       ),
       coined as (
         select item_id, min(posted_at) as posted_at,
                count(distinct address) filter (where minted_at >= posted_at + make_interval(secs => $3::double precision / 1000))::int as coins,
                min(minted_at) filter (where minted_at >= posted_at + make_interval(secs => $3::double precision / 1000)) as first_late_at,
                array_remove(array_agg(distinct author_key), null) as authors, array_remove(array_agg(distinct handle), null) as handles
           from timed group by item_id
       )
       select c.item_id, i.body, i.media, c.posted_at, c.coins, c.first_late_at, j.coinable, k.kind_label, n.names
         from coined c
         join public.item i on i.item_id = c.item_id and coalesce(i.body, '') <> ''
         left join lateral (select pj.coinable from internal.post_judgement pj
                             where pj.item_id = c.item_id and pj.prompt_id not like 'post-kind%'
                             order by pj.judged_at desc, pj.id desc limit 1) j on true
         left join lateral (select pj.proposed_name as kind_label from internal.post_judgement pj
                             where pj.item_id = c.item_id and pj.prompt_id like 'post-kind%'
                             order by pj.judged_at desc, pj.id desc limit 1) k on true
         left join lateral (select array_agg(distinct pj.proposed_name) as names from internal.post_judgement pj
                             where pj.item_id = c.item_id and pj.prompt_id not like 'post-kind%' and pj.proposed_name is not null) n on true
        where c.coins >= $2 and ($6::boolean or j.coinable = false)
          and not exists (select 1 from launchers d where (d.by = 'a' and d.who = any(c.authors)) or (d.by = 'h' and d.who = any(c.handles)))
        order by c.posted_at desc, c.item_id`,
      [q.source, q.minCoins, q.lateMs, q.deployerWindowMs, q.deployerMinPosts, q.anyAnswer === true],
    ));
    return rows.map((r) => ({ itemId: r.item_id, body: r.body, media: r.media, postedAt: r.posted_at, coins: Number(r.coins), firstLateAt: r.first_late_at, coinable: r.coinable, kindLabel: r.kind_label, names: r.names ?? [] }));
  }
}

/** A post several coins were launched for well after it, that the judge answered "no" (`coinedPosts`). */
export interface CoinedPostRow {
  readonly itemId: string;
  readonly body: string;
  readonly media: unknown;
  readonly postedAt: Date;
  readonly coins: number;
  /** The first of those late coins' launch. */
  readonly firstLateAt: Date;
  /** The judge's newest first-question answer: always false here unless `anyAnswer`, kept so the caller can say so. */
  readonly coinable: boolean | null;
  /** The newest kind answer, upper case as filed; null when the kind was never asked. */
  readonly kindLabel: string | null;
  /** Every name any judge proposed for the post (the coined-yes animal-or-object test). */
  readonly names: readonly string[];
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
