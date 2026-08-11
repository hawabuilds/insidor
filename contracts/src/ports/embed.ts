/**
 * THE EMBEDDING PORT — a representation of text or an image, from wherever.
 *
 * ONE PROPERTY MUST STAY TRUE: an embedding is TIER 2. The free tiers — perceptual
 * image hash, near-duplicate text, format ids, lineage pointers — are local,
 * deterministic and language-blind, and they do most of the grouping work before any
 * model exists. An embedding outage must DEGRADE grouping to those tiers, never stop
 * it. If an embedding ever becomes a precondition for joining a story, the whole
 * argument for using a hosted encoder evaporates and this comment is the record of
 * what was traded away.
 *
 * `space` exists because a similarity bar belongs to a representation, not to the
 * system. A bar calibrated against one space merges nearly everything when a
 * differently-shaped space is dropped in behind it — which is a real, expensive,
 * previously-shipped bug, not a hypothetical.
 */

import type { MediaRef } from '../vocabulary.ts';
import type { Budget, Metered } from './meter.ts';

export interface Embedding {
  /** Opaque space id, e.g. 'text.v2'. Vectors from different spaces never compare. */
  readonly space: string;
  readonly dimensions: number;
  readonly values: Float32Array;
}

export interface EmbedPort {
  readonly id: string;
  readonly space: string;
  readonly dimensions: number;
  readonly maxBatch: number;

  /** Order-preserving. A null slot means that input could not be embedded. */
  embedText(
    texts: readonly string[],
    budget: Budget,
  ): Promise<Metered<readonly (Embedding | null)[]>>;

  /** Optional: not every provider does images, and pretending otherwise costs money. */
  embedMedia?(
    media: readonly MediaRef[],
    budget: Budget,
  ): Promise<Metered<readonly (Embedding | null)[]>>;
}
