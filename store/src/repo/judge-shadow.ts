/**
 * The shadow judge's answers beside the live judge's (0089): written by the runner's shadow
 * (services/runner/src/judge-shadow.ts), read only by tools/judge-shadow-report.ts.
 *
 * Its own repository, and its own table, because these answers must never reach the feed: every
 * reader of internal.post_judgement takes a post's newest answer, and a shadow answer filed there
 * would become it. Nothing here is a judgement the system acts on.
 *
 * What breaks if changed carelessly: `record` writes the live answer as it was when both were
 * asked. Reading it back from post_judgement at report time instead would compare the shadow with
 * whatever later re-score replaced it.
 */

import type { Db } from '../client.ts';

/** One post's two answers. `shadow` null: the shadow gave none, and `shadowDetail` says why. */
export interface ShadowPair {
  readonly itemId: string;
  readonly askedAt: Date;
  readonly question: 'post' | 'kind';
  readonly live: { readonly judgeId: string; readonly promptId: string; readonly coinable: boolean; readonly confidence: number; readonly lookedAt: 'text' | 'picture' | 'videoFrame'; readonly name: string | null; readonly costUsd: number; readonly sPerPost: number | null };
  readonly shadow: { readonly judgeId: string; readonly promptId: string; readonly coinable: boolean; readonly confidence: number; readonly lookedAt: 'text' | 'picture' | 'videoFrame'; readonly name: string | null } | null;
  readonly shadowCostUsd: number;
  readonly shadowSPerPost: number | null;
  readonly shadowDetail: string | null;
}

export class PgJudgeShadowRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Whether the table exists (0089 applied); false only for an undefined table, any other error throws. */
  async ready(): Promise<boolean> {
    try {
      await this.#db.query('select 1 from internal.judge_shadow limit 0');
      return true;
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code === '42P01') return false;
      throw e;
    }
  }

  /** Appends the pairs in one statement. */
  async record(pairs: readonly ShadowPair[]): Promise<void> {
    if (pairs.length === 0) return;
    const cols = 20;
    const values: unknown[] = [];
    const rows = pairs.map((p, i) => {
      values.push(
        p.itemId, p.askedAt, p.question,
        p.live.judgeId, p.live.promptId, p.live.coinable, p.live.confidence, p.live.lookedAt, p.live.name, p.live.costUsd, p.live.sPerPost,
        p.shadow?.judgeId ?? null, p.shadow?.promptId ?? null, p.shadow?.coinable ?? null, p.shadow?.confidence ?? null, p.shadow?.lookedAt ?? null, p.shadow?.name ?? null,
        p.shadowCostUsd, p.shadowSPerPost, p.shadowDetail,
      );
      return `(${Array.from({ length: cols }, (_, k) => `$${i * cols + k + 1}`).join(', ')})`;
    });
    await this.#db.query(
      `insert into internal.judge_shadow
         (item_id, asked_at, question,
          live_judge_id, live_prompt_id, live_coinable, live_confidence, live_looked_at, live_name, live_cost_usd, live_s_per_post,
          shadow_judge_id, shadow_prompt_id, shadow_coinable, shadow_confidence, shadow_looked_at, shadow_name,
          shadow_cost_usd, shadow_s_per_post, shadow_detail)
       values ${rows.join(', ')}`,
      values,
    );
  }
}
