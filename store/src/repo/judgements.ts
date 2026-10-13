/**
 * The judge's answers, on disk. See store/migrations/0022_judgement.sql for why the table
 * exists and why only answers are in it.
 *
 * Two methods: write an answer, and read the newest answer per story. Reading back is
 * strict — a row whose closed-list column holds a value the code does not know is refused,
 * not guessed at, because a judgement read wrong is a decision replayed wrong.
 *
 * The per-post table has two more (0053): find an answer another post may reuse, and file it
 * as a copy that names where it came from — so a copy never passes for a second look.
 */

import type { Judgement, JudgeEvidence } from '@insidor/contracts';
import { JUDGE_EVIDENCE } from '@insidor/contracts';
import type { ItemId, StoryId } from '@insidor/contracts/ids.ts';
import type { JudgementRepo, RecordedJudgement } from '@insidor/contracts/ports/store.ts';

import type { Millis } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { toMillisRequired, toTimestamp } from '../rows.ts';
import type { TimestampColumn } from '../rows.ts';

interface JudgementRow {
  story_id: string;
  judged_at: TimestampColumn;
  member_count: number;
  judge_id: string;
  prompt_id: string;
  looked_at: string;
  coinable: boolean;
  confidence: number;
  proposed_name: string | null;
  alternate_names: unknown;
  subject_spans: unknown;
  cost_usd: string | number;
}

function toEvidence(value: string): JudgeEvidence {
  const known = JUDGE_EVIDENCE.find((e) => e === value);
  if (known === undefined) throw new TypeError(`internal.judgement.looked_at holds '${value}', which is not a JudgeEvidence`);
  return known;
}

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * Which table a repository reads and writes. Two fixed shapes and nothing else: the table and
 * key column are written into SQL, so they come from this closed list and never from input.
 *   story  internal.judgement, keyed by story — what QUALIFY reads.
 *   post   internal.post_judgement, keyed by item — one post judged alone, for the For You
 *          feed (0025). Same columns, so one mapping reads both.
 */
const TARGETS = {
  story: { table: 'internal.judgement', key: 'story_id' },
  post: { table: 'internal.post_judgement', key: 'item_id' },
} as const;

export class PgJudgementRepo implements JudgementRepo {
  readonly #db: Db;
  readonly #table: string;
  readonly #key: string;

  constructor(db: Db, target: keyof typeof TARGETS = 'story') {
    this.#db = db;
    this.#table = TARGETS[target].table;
    this.#key = TARGETS[target].key;
  }

  async record(storyId: StoryId, memberCount: number, j: Judgement): Promise<void> {
    await this.#db.query(
      `insert into ${this.#table}
         (${this.#key}, judged_at, member_count, judge_id, prompt_id, looked_at, coinable,
          confidence, proposed_name, alternate_names, subject_spans, cost_usd)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        String(storyId),
        toTimestamp(j.judgedAt),
        memberCount,
        j.judgeId,
        j.promptId,
        toEvidence(j.lookedAt),
        j.coinable,
        j.confidence,
        j.proposedName,
        JSON.stringify(j.alternateNames),
        JSON.stringify(j.subjectSpans),
        j.costUsd,
      ],
    );
  }

  async latest(storyIds: readonly StoryId[]): Promise<ReadonlyMap<StoryId, RecordedJudgement>> {
    const out = new Map<StoryId, RecordedJudgement>();
    if (storyIds.length === 0) return out;
    const rows = await this.#db.query<JudgementRow>(
      `select distinct on (${this.#key})
              ${this.#key} as story_id, judged_at, member_count, judge_id, prompt_id, looked_at, coinable,
              confidence, proposed_name, alternate_names, subject_spans, cost_usd
         from ${this.#table}
        where ${this.#key} = any($1::text[])
        order by ${this.#key}, judged_at desc, id desc`,
      [storyIds.map(String)],
    );
    for (const r of rows) {
      out.set(r.story_id as StoryId, {
        memberCount: r.member_count,
        judgement: {
          judgeId: r.judge_id,
          promptId: r.prompt_id,
          judgedAt: toMillisRequired(r.judged_at, 'internal.judgement.judged_at'),
          coinable: r.coinable,
          confidence: r.confidence,
          lookedAt: toEvidence(r.looked_at),
          proposedName: r.proposed_name,
          alternateNames: strings(r.alternate_names),
          subjectSpans: strings(r.subject_spans),
          // Never stored; the prose stays out of this table as it stays out of every other.
          rationaleRef: null,
          costUsd: Number(r.cost_usd),
        },
      });
    }
    return out;
  }
}

/**
 * The judge's answers about single posts (internal.post_judgement), keyed by item.
 *
 * A wrapper rather than a second copy of the SQL: the table has the same columns as the
 * story table, so the story repository reads and writes it when told to. The one cast
 * below is the key's brand — an item id passed through a parameter typed for a story id —
 * and it never leaves this class.
 */
export class PgPostJudgementRepo {
  readonly #db: Db;
  readonly #inner: PgJudgementRepo;

  constructor(db: Db) {
    this.#db = db;
    this.#inner = new PgJudgementRepo(db, 'post');
  }

  async record(itemId: ItemId, judgement: Judgement): Promise<void> {
    await this.#inner.record(itemId as unknown as StoryId, 1, judgement);
  }

  /**
   * File another post's answer for this one (0053): the same judge and prompt ids, the cost the
   * caller gives (zero — nothing was asked), and `copied_from` naming whose answer it is.
   */
  async recordCopy(itemId: ItemId, judgement: Judgement, copiedFrom: ItemId): Promise<void> {
    await this.#db.query(
      `insert into internal.post_judgement
         (item_id, judged_at, member_count, judge_id, prompt_id, looked_at, coinable,
          confidence, proposed_name, alternate_names, subject_spans, cost_usd, copied_from)
       values ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        String(itemId),
        toTimestamp(judgement.judgedAt),
        judgement.judgeId,
        judgement.promptId,
        toEvidence(judgement.lookedAt),
        judgement.coinable,
        judgement.confidence,
        judgement.proposedName,
        JSON.stringify(judgement.alternateNames),
        JSON.stringify(judgement.subjectSpans),
        judgement.costUsd,
        String(copiedFrom),
      ],
    );
  }

  async latest(itemIds: readonly ItemId[]): Promise<ReadonlyMap<ItemId, Judgement>> {
    const found = await this.#inner.latest(itemIds as unknown as readonly StoryId[]);
    return new Map([...found].map(([key, recorded]) => [key as unknown as ItemId, recorded.judgement]));
  }

  /**
   * Answers this judge, under this prompt, gave since `since` that another post may reuse:
   *
   *   byItem   the newest answer about each of `itemIds` (the posts a repost or a quote points at);
   *   byImage  for each uri, the newest answer about a post whose FIRST picture is that uri and
   *            which the judge was shown (`looked_at = 'picture'`) — an answer given on the words
   *            alone says nothing about the picture.
   *
   * Each comes with the post the answer was first given about: a copy of a copy names the
   * original, so one judgement never looks like two in `copied_from`.
   */
  async reusable(q: {
    readonly itemIds: readonly ItemId[];
    readonly imageUris: readonly string[];
    readonly judgeId: string;
    readonly promptId: string;
    readonly since: Millis;
  }): Promise<{ readonly byItem: ReadonlyMap<string, ReusableAnswer>; readonly byImage: ReadonlyMap<string, ReusableAnswer> }> {
    const byItem = new Map<string, ReusableAnswer>();
    const byImage = new Map<string, ReusableAnswer>();
    const columns = `pj.judged_at, pj.judge_id, pj.prompt_id, pj.looked_at, pj.coinable, pj.confidence,
                     pj.proposed_name, pj.alternate_names, pj.subject_spans, pj.cost_usd,
                     coalesce(pj.copied_from, pj.item_id) as source_id`;
    if (q.itemIds.length > 0) {
      const rows = await this.#db.query<AnswerRow & { key: string; source_id: string }>(
        `select distinct on (pj.item_id) pj.item_id as key, ${columns}
           from internal.post_judgement pj
          where pj.item_id = any($1::text[]) and pj.judge_id = $2 and pj.prompt_id = $3 and pj.judged_at >= $4
          order by pj.item_id, pj.judged_at desc, pj.id desc`,
        [q.itemIds.map(String), q.judgeId, q.promptId, toTimestamp(q.since)],
      );
      for (const r of rows) byItem.set(r.key, { sourceId: r.source_id as ItemId, judgement: toJudgement(r) });
    }
    if (q.imageUris.length > 0) {
      const rows = await this.#db.query<AnswerRow & { key: string; source_id: string }>(
        `select distinct on (first_image.uri) first_image.uri as key, ${columns}
           from internal.post_judgement pj
           join public.item i on i.item_id = pj.item_id
           cross join lateral (
             select m ->> 'uri' as uri
               from jsonb_array_elements(i.media) with ordinality as t(m, n)
              where m ->> 'kind' = 'image' and coalesce(m ->> 'uri', '') <> ''
              order by n
              limit 1
           ) first_image
          where first_image.uri = any($1::text[]) and pj.looked_at = 'picture'
            and pj.judge_id = $2 and pj.prompt_id = $3 and pj.judged_at >= $4
          order by first_image.uri, pj.judged_at desc, pj.id desc`,
        [[...q.imageUris], q.judgeId, q.promptId, toTimestamp(q.since)],
      );
      for (const r of rows) byImage.set(r.key, { sourceId: r.source_id as ItemId, judgement: toJudgement(r) });
    }
    return { byItem, byImage };
  }
}

/** An answer about one post that another may reuse, and the post it was first given about. */
export interface ReusableAnswer {
  readonly sourceId: ItemId;
  readonly judgement: Judgement;
}

/** One answer's columns, whichever post or story it is keyed by. */
type AnswerRow = Omit<JudgementRow, 'story_id' | 'member_count'>;

function toJudgement(r: AnswerRow): Judgement {
  return {
    judgeId: r.judge_id,
    promptId: r.prompt_id,
    judgedAt: toMillisRequired(r.judged_at, 'internal.post_judgement.judged_at'),
    coinable: r.coinable,
    confidence: Number(r.confidence),
    lookedAt: toEvidence(r.looked_at),
    proposedName: r.proposed_name,
    alternateNames: strings(r.alternate_names),
    subjectSpans: strings(r.subject_spans),
    rationaleRef: null,
    costUsd: Number(r.cost_usd),
  };
}
