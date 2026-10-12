/**
 * The judge's answers, on disk. See store/migrations/0022_judgement.sql for why the table
 * exists and why only answers are in it.
 *
 * Two methods: write an answer, and read the newest answer per story. Reading back is
 * strict — a row whose closed-list column holds a value the code does not know is refused,
 * not guessed at, because a judgement read wrong is a decision replayed wrong.
 */

import type { Judgement, JudgeEvidence } from '@insidor/contracts';
import { JUDGE_EVIDENCE } from '@insidor/contracts';
import type { ItemId, StoryId } from '@insidor/contracts/ids.ts';
import type { JudgementRepo, RecordedJudgement } from '@insidor/contracts/ports/store.ts';

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
  readonly #inner: PgJudgementRepo;

  constructor(db: Db) {
    this.#inner = new PgJudgementRepo(db, 'post');
  }

  async record(itemId: ItemId, judgement: Judgement): Promise<void> {
    await this.#inner.record(itemId as unknown as StoryId, 1, judgement);
  }

  async latest(itemIds: readonly ItemId[]): Promise<ReadonlyMap<ItemId, Judgement>> {
    const found = await this.#inner.latest(itemIds as unknown as readonly StoryId[]);
    return new Map([...found].map(([key, recorded]) => [key as unknown as ItemId, recorded.judgement]));
  }
}
