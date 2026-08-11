/**
 * THE FILE THAT PROVES THE ABSTRACTION IS REAL.
 *
 * This source has no reproduction COUNT. None. It exposes a lineage POINTER on
 * the child item — a stitch or a duet names its parent — which means the only
 * way to count reproductions here is to find the children, which means you can
 * only count the ones you happened to ingest. That is a corpus join, not a
 * field read, and it is incomplete by construction.
 *
 * So `absent: ['reproduction']` is declared here and the counter is omitted
 * from every Item this adapter produces.
 *
 * WHY THIS IS THE MOST IMPORTANT LINE IN THE PACKAGE. The build this replaces
 * hardcoded `quotes = 0` for every post from this source, because the parser
 * had a column to fill and no way to say "there is no such thing here".
 * Reproduction is the reproduction signal the entire product rests on. A zero
 * does not read as "unknown" downstream; it reads as "nobody copied this",
 * which is the exact opposite of what an uncounted stitch means. Every post
 * from this source looked uncopied for as long as that line existed, and
 * nothing objected, because there was no shape to object to.
 *
 * The two rules that follow, and neither is negotiable:
 *   1. Never map another counter into `reproduction` to fill the gap. A share
 *      count is a rebroadcast and belongs in `rebroadcast`.
 *   2. Never emit `reproduction: { value: 0 }`. Absent is a Fidelity, not a
 *      number, and core reads `capabilities.absent` rather than null-checking.
 *
 * Core covers the gap the honest way: it derives reproduction from the
 * fingerprint index — how many distinct authors posted an item sharing this
 * image hash or this sound id — which is platform-blind, works everywhere, and
 * is strictly better evidence. It just costs an index scan instead of a read.
 */

import type { CounterKind, Fidelity } from '@insidor/contracts';
import { sourceId } from '@insidor/contracts/ids.ts';
import type { Capabilities } from '@insidor/contracts/ports/platform.ts';
import type { Price, PriceBook } from '@insidor/meter';

export const SOURCE = sourceId('tiktok');
export const VENDOR = 'apify';

/**
 * Measured against live payloads, not assumed, which is why they differ per
 * field inside one object: play and approval counts round to 4 significant
 * figures; comment, share and save counts are exact.
 */
export const FIDELITY = {
  reach: { kind: 'quantized', significantDigits: 4 },
  approval: { kind: 'quantized', significantDigits: 4 },
  conversation: { kind: 'exact' },
  rebroadcast: { kind: 'exact' },
  retention: { kind: 'exact' },
  /**
   * Declared for completeness and never attached to a Counter: an absent
   * concept produces no reading at all. It is here so that anyone reaching for
   * a reproduction fidelity finds this comment instead of inventing one.
   */
  reproduction: { kind: 'absent' },
} as const satisfies Readonly<Partial<Record<CounterKind, Fidelity>>>;

export const CAPABILITIES: Capabilities = {
  source: SOURCE,
  counters: ['reach', 'approval', 'conversation', 'rebroadcast', 'retention'],
  absent: ['reproduction'],
  fidelity: FIDELITY,
  /** No keyword search: hashtag, feed and account are the only entry points. */
  discovery: ['hashtag', 'feed', 'account'],
  observeBatchSize: 50,
  /** A lineage pointer exists (stitch, duet) even though a count does not. */
  lineage: true,
  /** This vendor bills per actor run. It cannot be priced per item returned. */
  billing: 'per-run',
};

export const DISCOVER = 'discover';
export const OBSERVE = 'observe';

const price = (endpoint: string, usdPerUnit: number): Price => ({
  vendor: VENDOR,
  endpoint,
  unit: 'per-run',
  usdPerUnit,
  unitName: 'actor run',
  measuredAt: '2026-08-05',
});

export const PRICES: PriceBook = {
  [`${VENDOR}:${DISCOVER}`]: price(DISCOVER, 0.02),
  [`${VENDOR}:${OBSERVE}`]: price(OBSERVE, 0.02),
};
