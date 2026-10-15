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
   * Keyword search first: the scraper's video search (checked against its input
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
/** The trend list's actor (trends.ts): its own endpoint on the ledger, so its cost is its own line in the report. */
export const TRENDS = 'trends';

/**
 * ★ THE MOST POSTS ONE DISCOVERY RUN MAY ASK FOR, AND THE REASON THE PRICE BELOW IS TRUE.
 *
 * The scraper is billed per run started AND per post it returns (pay-per-event, read from
 * the actor's own pricing on 2026-10-13). The ledger counts runs, so a run's price is only
 * an honest bound if the number of posts in it is bounded — which is this cap: `discover.ts`
 * never asks for more, whatever `query.limit` says. Raising it raises the quoted price with
 * it, so a bigger run can never be cheaper on paper than it is on the invoice.
 *
 * ★ 20 SINCE 2026-10-13, EQUAL TO `policy.feed.hashtagResults` — the posts the runner asks for
 * per hashtag ask. Above it, every run would be quoted (and recorded, and spaced by the runner's
 * `watchEveryMs`) at a bill twice what is asked; below it, the policy's ask would be silently
 * cut short. The test beside discover.ts holds the two equal: raise one, raise both.
 */
export const DISCOVER_RESULTS_CAP = 20;

/**
 * The scraper's per-event charges on our plan tier (BRONZE), in dollars. Vendor prices, not
 * product choices, which is why they sit at the vendor edge and not in policy. A lower plan
 * tier charges about a quarter more per post; re-measure if the plan changes.
 */
export const RUN_START_USD = 0.001;
export const PER_POST_USD = 0.003;
/* ★ THE TWO CHARGED SEARCH FILTERS, PER POST: an order (`mobile-filter-sorting-applied`) and the
   past-day window (`filter-applied`), $0.001 each. Read from the vendor's own itemised charges on
   2026-10-13 (runs of 10 at 14:05 and 14:12 UTC billed $0.051: $0.001 + 10 × $0.005). The $0.0005
   here before came from a total that had not finished settling, and quoted a full ask at $0.071
   against a real $0.101 — so each ask was spaced as if it cost seven tenths of what it did. */
export const SEARCH_FILTERS_PER_POST_USD = 0.002;

const price = (endpoint: string, usdPerUnit: number): Price => ({
  vendor: VENDOR,
  endpoint,
  unit: 'per-run',
  usdPerUnit,
  unitName: 'actor run',
  measuredAt: '2026-10-13',
});

/**
 * ★ EACH RUN IS QUOTED AT ITS LARGEST POSSIBLE BILL, AND RECORDED AT WHAT IT REALLY COST. The
 * unit stays the run, and the quote — what the budget is checked against before the call, and
 * what the runner spaces its asks by — is the start fee plus a full run's posts:
 * `DISCOVER_RESULTS_CAP` search results, or a full observe batch. Once the run is back, the
 * vendor's bill is known exactly — it charges per post returned, at the rates above — so the
 * ledger records that (`runCostUsd`), not the quote. Until 2026-10-13 the quote was recorded:
 * a re-read of three posts went down as fifty, and a search that failed with nothing in it as a
 * full one, so the line ran out on paper hours before it did on the invoice. A run that throws
 * is still recorded at the quote: what it was billed is not known then, and too high is the
 * safe side.
 */
export const PRICES: PriceBook = {
  [`${VENDOR}:${DISCOVER}`]: price(DISCOVER, RUN_START_USD + DISCOVER_RESULTS_CAP * (PER_POST_USD + SEARCH_FILTERS_PER_POST_USD)),
  [`${VENDOR}:${OBSERVE}`]: price(OBSERVE, RUN_START_USD + (CAPABILITIES.observeBatchSize ?? 1) * PER_POST_USD),
  /* One region's trend-list run at its most words (trends.ts): $0.025 to start, $0.001 a word. */
  [`${VENDOR}:${TRENDS}`]: price(TRENDS, 0.025 + 50 * 0.001),
};

/** What a run that came back with `posts` posts was billed: the start fee and each post's fees. */
export const runCostUsd = (posts: number, perPostUsd: number): number => RUN_START_USD + Math.max(0, posts) * perPostUsd;

/**
 * ★ THE NEWEST-FIRST SEARCH ACTOR'S CHARGES (search-actor.ts), BRONZE tier, read from its own pricing
 * and checked against a settled run on 2026-10-13 (16:11 UTC: 2 words, 58 videos, $0.0264 = $0.00022
 * + 2 × $0.00233 + 58 × $0.00037). A start fee, a fee per word searched, a fee per video. Its
 * `result-item` event is listed at the same price and was not charged on that run; if it ever is,
 * the recorded cost below runs under the invoice by that much and this is the line to change.
 */
export const SEARCH_ACTOR_START_USD = 0.00022;
export const SEARCH_ACTOR_PER_WORD_USD = 0.00233;
export const SEARCH_ACTOR_PER_POST_USD = 0.00037;

/**
 * A newest-first ask of `words` words — one run a word (discover.ts) — quoted at the actor's 30
 * videos a run, and what one that came back with `posts` videos in all was billed. The quote is the
 * ask's price before the call and what the runner spaces its asks by: four words, $0.0546.
 */
export const searchActorQuoteUsd = (words: number, perWordPosts: number): number =>
  Math.max(1, words) * (SEARCH_ACTOR_START_USD + SEARCH_ACTOR_PER_WORD_USD + perWordPosts * SEARCH_ACTOR_PER_POST_USD);
export const searchActorCostUsd = (words: number, posts: number): number =>
  Math.max(1, words) * (SEARCH_ACTOR_START_USD + SEARCH_ACTOR_PER_WORD_USD) + Math.max(0, posts) * SEARCH_ACTOR_PER_POST_USD;

/** The per-post fee of a search ask (the post and both filters) and of a re-read. */
export const SEARCH_POST_USD = PER_POST_USD + SEARCH_FILTERS_PER_POST_USD;
export const READ_POST_USD = PER_POST_USD;
