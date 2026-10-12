/**
 * THE IMAGE EMBEDDING STEP: each new post's picture embedded once, after each discovery pass.
 *
 * Its own step because the vectors are what GROUP's image evidence is read from, and they
 * must exist before GROUP decides about a post — so the step runs right after the pass that
 * stored the post. GROUP itself never calls the vendor (core is pure); it reads the stored
 * vectors through the store.
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

export async function embedImages(deps: EmbeddingDeps): Promise<{ readonly queued: number; readonly embedded: number }> {
  if (deps.embed === null || deps.embed.embedMedia === undefined) return { queued: 0, embedded: 0 };
  const now = deps.now();
  const queue = await deps.images.unembedded(
    deps.embed.space,
    (now - deps.policy.track.maxTrackedHours * MS_PER_HOUR) as Millis,
    deps.policy.group.imagesPerPass,
  );
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
