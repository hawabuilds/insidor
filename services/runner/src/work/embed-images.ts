/**
 * THE IMAGE EMBEDDING STEP: a post's picture embedded once, after each discovery pass.
 *
 * Its own step because the vectors are read in two places — GROUP's image evidence and the
 * feed's picture boost — and neither may call the vendor (core is pure). GROUP itself reads
 * the stored vectors through the store.
 *
 * ★ ONLY PICTURES SOMETHING WILL READ (2026-10-13). A post is embedded when the judge passed it
 * or said "yes" just under its bar (`couldStillPass`: the boost compares such a post with coined
 * pictures, so it needs the vector), or when it is in a promoted story or was fetched by a
 * story's backfill (a post joining that narrative is compared with its pictures). Any "no",
 * a failed name test and a post nobody has judged yet are not: until 2026-10-13 every new
 * picture was embedded, and about five in six went to posts that could never reach a screen.
 * The cost of the cut: a fresh post is usually judged after GROUP has already placed it, so it
 * meets GROUP without a vector of its own — which in the live log never mattered (no picture
 * join, `M2_semantic_join`, has ever been recorded), and a post naming a coin is compared with
 * the coin's picture only once it has passed (universe.ts; no picture match has linked a coin
 * yet either). Scoring runs before this step in every pass, so a post is embedded in the same
 * pass that judges it.
 *
 * ★ A MISSING VECTOR DEGRADES, NEVER BLOCKS. With no key, in a dry run, past the supplier
 * line, or on a failed call, posts simply have no vector and GROUP groups them on the free
 * tiers. Nothing waits on this step.
 *
 * What breaks if changed carelessly: an image is embedded once per space. Re-embedding on
 * every pass would spend the embeddings line on pictures we already hold.
 */

import type { Millis } from '@insidor/contracts';
import type { EmbedPort } from '@insidor/contracts/ports/embed.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { PgImageEmbeddingRepo } from '@insidor/store';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';
import { couldStillPass } from './track-gate.ts';

export interface EmbeddingDeps {
  /** null when no embedding vendor is configured: every post goes without, and GROUP degrades. */
  readonly embed: EmbedPort | null;
  readonly images: Pick<PgImageEmbeddingRepo, 'unembedded' | 'record'>;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

const MS_PER_HOUR = 3_600_000;
/** How long one batch of images may take before the call is abandoned. */
const EMBED_CALL_DEADLINE_MS = 60_000;
/** How many candidates are read per picture embedded: the store drops every "no", this step drops
    the rest that cannot pass (a failed name test, a yes far under the bar), so they cannot crowd the batch. */
const PREFETCH_FACTOR = 5;
/** The store drops every "no" above this confidence: below every confidence, since the picture boost never lifts a "no" (policy rising.boostBarMargin). */
const EVERY_NO_IS_FIRM = -1;

export async function embedImages(deps: EmbeddingDeps): Promise<{ readonly queued: number; readonly embedded: number }> {
  if (deps.embed === null || deps.embed.embedMedia === undefined) return { queued: 0, embedded: 0 };
  const now = deps.now();
  const wide = await deps.images.unembedded(
    deps.embed.space,
    (now - deps.policy.track.maxTrackedHours * MS_PER_HOUR) as Millis,
    deps.policy.group.imagesPerPass * PREFETCH_FACTOR,
    EVERY_NO_IS_FIRM,
  );
  const queue = wide
    .filter((q) => q.inNarrative || (q.judgement !== null && couldStillPass(q.judgement, deps.policy)))
    .slice(0, deps.policy.group.imagesPerPass);
  if (queue.length === 0) return { queued: 0, embedded: 0 };
  if (deps.mode === 'dry') {
    deps.log.info('DRY RUN — images to embed, not sent', { images: queue.length });
    return { queued: queue.length, embedded: 0 };
  }

  try {
    const result = await deps.embed.embedMedia(
      queue.map((q) => ({ kind: 'image', uri: q.uri, width: null, height: null, durationMs: null })),
      { capUsd: deps.policy.budget.supplierLines.embeddings, spentUsd: 0, maxCalls: null, deadline: (now + EMBED_CALL_DEADLINE_MS) as Millis },
    );
    let embedded = 0;
    for (const [index, embedding] of result.value.entries()) {
      const q = queue[index];
      if (q === undefined || embedding === null) continue;
      await deps.images.record('item', q.itemId, q.uri, embedding.space, embedding.values, now);
      embedded += 1;
    }
    deps.log.info('images embedded', { queued: queue.length, embedded, usd: result.spend.usd });
    return { queued: queue.length, embedded };
  } catch (e) {
    if (e instanceof BudgetRefused) {
      deps.log.warn('image embedding paused for budget; these posts go without for now', { images: queue.length });
    } else {
      deps.log.error('image embedding failed; these posts go without for now', { images: queue.length, err: errorText(e) });
    }
    return { queued: queue.length, embedded: 0 };
  }
}
