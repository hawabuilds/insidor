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
  /**
   * Keyword search first: the scraper's video search, newest first (checked against its input
   * schema on 2026-10-13 — `searchQueries`). There is no trending or explore feed to enter by,
   * so nothing here is a catch-all; hashtag and account remain for a caller that wants them.
   */
  discovery: ['keyword', 'hashtag', 'feed', 'account'],
  observeBatchSize: 50,
  /** A lineage pointer exists (stitch, duet) even though a count does not. */
  lineage: true,
  /**
   * The ledger's unit is the run: the vendor charges per run AND per post, and the posts are
   * bounded per run, so each run is quoted at its full bill — see `PRICES`.
   */
  billing: 'per-run',
};

export const DISCOVER = 'discover';
export const OBSERVE = 'observe';

/**
 * ★ THE MOST POSTS ONE DISCOVERY RUN MAY ASK FOR, AND THE REASON THE PRICE BELOW IS TRUE.
 *
 * The scraper is billed per run started AND per post it returns (pay-per-event, read from
 * the actor's own pricing on 2026-10-13). The ledger counts runs, so a run's price is only
 * an honest bound if the number of posts in it is bounded — which is this cap: `discover.ts`
 * never asks for more, whatever `query.limit` says. Raising it raises the quoted price with
 * it, so a bigger run can never be cheaper on paper than it is on the invoice.
 */
export const DISCOVER_RESULTS_CAP = 20;

/**
 * The scraper's per-event charges on our plan tier (BRONZE), in dollars. Vendor prices, not
 * product choices, which is why they sit at the vendor edge and not in policy. A lower plan
 * tier charges about a quarter more per post; re-measure if the plan changes.
 */
const RUN_START_USD = 0.001;
const PER_POST_USD = 0.003;
/** The add-on charged per post when a video search is sorted newest first. */
const NEWEST_FIRST_PER_POST_USD = 0.001;

const price = (endpoint: string, usdPerUnit: number): Price => ({
  vendor: VENDOR,
  endpoint,
  unit: 'per-run',
  usdPerUnit,
  unitName: 'actor run',
  measuredAt: '2026-10-13',
});

/**
 * ★ EACH RUN IS QUOTED AT ITS LARGEST POSSIBLE BILL, and that is deliberate. The unit stays
 * the run — the ledger cannot see how many posts came back before it records — so the quote
 * is the start fee plus a full run's posts: `DISCOVER_RESULTS_CAP` sorted search results, or
 * a full observe batch. A short run is therefore over-recorded, never under-recorded. The
 * flat two cents that was here before was about a seventh of a full observe batch's real
 * bill, which made the supplier line a cap on paper only.
 */
export const PRICES: PriceBook = {
  [`${VENDOR}:${DISCOVER}`]: price(
    DISCOVER,
    RUN_START_USD + DISCOVER_RESULTS_CAP * (PER_POST_USD + NEWEST_FIRST_PER_POST_USD),
  ),
  [`${VENDOR}:${OBSERVE}`]: price(OBSERVE, RUN_START_USD + (CAPABILITIES.observeBatchSize ?? 1) * PER_POST_USD),
};
