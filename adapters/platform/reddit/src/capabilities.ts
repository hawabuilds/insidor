/**
 * THE FILE WHERE THIS SOURCE ADMITS WHAT IT IS NOT.
 *
 * Two adapters came before this one and both declared a nearly full house: X
 * declares `absent: []`, TikTok declares `absent: ['reproduction']`. This source
 * declares FOUR of the six counters absent, which is why it is the one worth
 * reading before writing a fifth adapter. `Capabilities.absent` was made
 * REQUIRED rather than optional for a source shaped exactly like this one, and
 * until now nothing in the repository actually exercised that.
 *
 * ── 1. THERE IS NO REACH COUNT HERE. NONE. ────────────────────────────────
 *
 * Not rounded, not withheld, not behind an extra call: this source's public
 * post payload has no impression-like field under any spelling. Its own JSON
 * serialiser emits `archived, visited, clicked, contest_mode, domain, downs,
 * gilded, hidden, hide_score, is_self, likes, link_flair_*, locked, media,
 * num_comments, over_18, permalink, quarantine, saved, score, stickied,
 * subreddit, subreddit_id, thumbnail, title, ups, url` and nothing that counts
 * eyeballs. The moderator-only view of a community reports view figures; a
 * public listing never has.
 *
 * So `reach` is in `absent` and is OMITTED FROM EVERY CounterSet — the key is
 * not present, not `{ value: null }`, not `{ value: 0 }`. The contract suite
 * asserts `kind in item.counters === false`, which means even writing the key
 * with an undefined value fails, and that strictness is the point. The build
 * this replaces hardcoded a view floor (`snapshotter.js:49-50`), under which a
 * source with no reach is not merely mismeasured, it is UNDETECTABLE: every
 * post fails a floor it can never clear, and the board simply never shows this
 * platform. Nothing errors. The whole source just goes quiet.
 *
 * The three rules, and none of them is negotiable:
 *   1. Never substitute the vote score or the comment count into `reach`. They
 *      are different things and one of them is not even trustworthy.
 *   2. Never emit `reach: { value: 0 }`. Zero reads downstream as "nobody saw
 *      this", which is a measurement, and we have not made one.
 *   3. Never emit `reach: { value: null, fidelity: { kind: 'absent' } }`
 *      either. `value: null` means "not read THIS TIME"; the concept existing
 *      but being unread is a different fact from the concept not existing.
 *
 * ── 2. THE VOTE SCORE IS DELIBERATELY PERTURBED, AND THAT IS A FIDELITY ───
 *
 * This source fuzzes its vote counts on purpose, to frustrate anyone trying to
 * reverse-engineer the ranking. That is an adversarial perturbation, not a
 * rounding, and the vocabulary has a variant for exactly it — `{ kind:
 * 'fuzzed' }`, which is the ONLY Fidelity variant carrying no parameter. That
 * missing parameter is the design: `quantized` takes `significantDigits`
 * because a rounding source tells you its resolution, and a fuzzing source
 * deliberately does not. There is no number to declare here, and inventing one
 * would be the exact failure this package exists to avoid.
 *
 * WHAT WE COULD NOT FIND, STATED PLAINLY BECAUSE IT MATTERS: the magnitude of
 * the fuzz is UNDOCUMENTED. It is acknowledged in public only as "some slight
 * fuzzing"; no distribution, no scale, no rule. The one fuzzing routine this
 * source ever open-sourced is for the active-visitor count rather than for
 * votes, and its jitter DECAYS as the count grows (`round(5 * exp(-count/60))`,
 * capped at 5) — i.e. it perturbs small numbers and stops perturbing large
 * ones, which is the inverse of the folk belief that big scores wobble more.
 * The same file also records that the fuzzed value is CACHED so it stays stable
 * across reads, "to prevent repeated requests from revealing the range of
 * fuzzing" — so the size is not merely undocumented, it is deliberately
 * unmeasurable by polling. Declaring `quantized` with a made-up digit count
 * would be a measurement claim resting on nothing.
 *
 * WHAT `fuzzed` COSTS, so nobody discovers it by surprise: the censoring rule
 * checks fidelity FIRST, so a fuzzed counter yields `censored/unusable_fidelity`
 * at every interval, forever, and carries `lastLevel: null` — the level is
 * dropped too, not just the rate. `approval` on this source therefore
 * contributes no rate, no level, and nothing to a burst. That is a strong
 * statement and it is the correct one: we cannot difference a number the source
 * is randomising, and we cannot say how big it "really" is either.
 *
 * The consequence is that `conversation` is this source's ONLY rate-bearing
 * counter. Written down deliberately, because it is a product fact rather than
 * an accident of a fidelity line: everything kinetic we will ever say about
 * this source rides on comment velocity. That is defensible — comment counts
 * are not fuzzed, are far more expensive to manufacture than votes, and are a
 * better proxy for "people are making something of this" than a vote tally —
 * but it is a judgement, and it belongs on the record rather than buried.
 *
 * ── 3. NO REBROADCAST, NO RETENTION, AND A REPRODUCTION COUNT WE HAVE NOT
 *       SEEN YET ───────────────────────────────────────────────────────────
 *
 * `rebroadcast` — a copy that creates NO new authored object. This source has
 * no such object. Re-posting here MAKES A NEW POST with a new author, which is
 * reproduction; an award is a payment, not a copy; a share link is an outbound
 * URL nobody counts back. Absent, and specifically NOT the place to file a
 * crosspost count, which would invert the one signal the product sells.
 *
 * `retention` — saved for later. The payload's `saved` field is a BOOLEAN ABOUT
 * US: whether the account we authenticated as has saved this post. A fact about
 * the reader is not a count about the item, and `saved: false` mapped to
 * `retention: 0` would be the port header's warning made literal — "a zero is
 * indistinguishable from a measurement". Absent.
 *
 * `reproduction` — ★ THE ONE TO REVISIT FIRST. A crosspost on this source is a
 * textbook reproduction: a new authored object that names its parent. The
 * lineage POINTER is read (see to-item.ts) and `lineage: true` below is honest
 * because of it. The COUNT, `num_crossposts`, is believed to exist on modern
 * payloads but could not be confirmed against a primary source — it postdates
 * the open-sourced serialiser and is not in the reference client's documented
 * attribute table. Reproduction is the signal this product is built on, so it
 * is declared ABSENT until a RECORDED payload shows the field. The asymmetry is
 * the whole reason: absent-when-present costs us a signal we could have had;
 * present-when-absent manufactures one we never had, and a manufactured
 * reproduction count is the defect this rebuild exists to remove.
 *
 * Promoting it later is three lines and no migration: move `'reproduction'`
 * from `absent` to `counters`, change its FIDELITY entry from `{ kind:
 * 'absent' }` to `{ kind: 'exact' }`, and add the counter in `toCounters`. Do
 * it in the same commit that replaces the fixtures with a recording.
 */

import type { CounterKind, Fidelity } from '@insidor/contracts';
import { sourceId } from '@insidor/contracts/ids.ts';
import type { Capabilities } from '@insidor/contracts/ports/platform.ts';
import type { Price, PriceBook } from '@insidor/meter';

export const SOURCE = sourceId('reddit');

/**
 * The vendor IS the platform here — there is no reseller and no scraper in
 * between, which is what makes this the first adapter with a real HTTP body
 * rather than a signature. Kept as its own constant anyway, because the meter
 * bills a vendor and a vendor is not a source: the day a reseller appears in
 * front of this API, one line changes and the ledger stays comparable.
 */
export const VENDOR = 'reddit';

export const FIDELITY = {
  /**
   * ★ Adversarially perturbed at the source, and the variant takes no
   * parameter because the source publishes no resolution. See the fuzz section
   * of this file's header before changing this to `quantized` — the `quantized`
   * spelling is more useful downstream (it censors only sub-step changes and it
   * carries the level forward) and it is more useful precisely because it
   * claims more, which is the reason we may not spell it that way here.
   */
  approval: { kind: 'fuzzed' },
  /**
   * A straight count of a tree of replies. Not vote-derived, so not fuzzed, and
   * not rounded at any magnitude we have seen. Note the denominator differs
   * from the other sources' — this is EVERY comment in the thread, where
   * another source counts direct replies only. That is fine and needs no
   * reconciliation: a counter is only ever compared against itself on its own
   * source, which is what `baselineKey` exists to enforce.
   */
  conversation: { kind: 'exact' },

  /* The four below are declared and NEVER attached to a Counter. They exist so
     that the next person who reaches for one of these fidelities finds this
     file's argument instead of inventing a number. */
  reach: { kind: 'absent' },
  rebroadcast: { kind: 'absent' },
  reproduction: { kind: 'absent' },
  retention: { kind: 'absent' },
} as const satisfies Readonly<Partial<Record<CounterKind, Fidelity>>>;

export const CAPABILITIES: Capabilities = {
  source: SOURCE,
  counters: ['approval', 'conversation'],
  absent: ['reach', 'rebroadcast', 'reproduction', 'retention'],
  fidelity: FIDELITY,
  /**
   * Two entry points, and both are exercised. A third is expressible — this
   * source can list one account's submissions — and is deliberately NOT
   * declared: a mode in this list that no code path renders is a claim nothing
   * checks, and the first caller to try it gets a runtime surprise instead of a
   * compile-time absence.
   *
   * `hashtag` and `catalog` do not exist on this source in any form.
   */
  discovery: ['feed', 'keyword'],
  /** The batch lookup endpoint accepts this many fullnames in one request. */
  observeBatchSize: 100,
  /** A crosspost names its parent, so the pointer exists even where the count is unproven. */
  lineage: true,
  /**
   * ★ FREE, AND STILL METERED PER CALL. See PRICES below for why this is
   * 'per-call' rather than the 'flat' the repo's other free vendor declares.
   */
  billing: 'per-call',
};

/* ── price book ───────────────────────────────────────────────────────── */

/**
 * Endpoint labels for the LEDGER. Narrow on purpose: prices are per endpoint,
 * and one row per logical call is what makes a per-decision cost addable.
 */
export const LISTING = 'listing';
export const INFO = 'info';
export const TOKEN = 'token';

/**
 * ★ WHY THIS SOURCE IS PRICED AT ZERO AND STILL GOES THROUGH THE METER.
 *
 * The call happens, so the ledger says the call happened. The alternative —
 * `freeSpend`, the `units: 0` row the replay source uses — asserts that no
 * vendor was contacted at all, which would make the budget that actually binds
 * here invisible in the one record that has to stay factual. This follows the
 * repo's other free vendor exactly.
 *
 * ★ WHY 'per-call' AND NOT THE 'flat' THAT VENDOR CHOSE. Two reasons, and both
 * are about what the unit MEANS rather than about the dollar figure, which is
 * zero either way:
 *
 *   1. 'flat' means "a subscription exists and one more call is marginally
 *      free", which is why `usdFor` returns 0 for it REGARDLESS OF UNITS. There
 *      is no subscription here and no monthly line to book it against. Under
 *      'flat' the ledger's dollars would be right by accident; under
 *      'per-call' they are right by construction — `usdPerUnit 0 × n calls`.
 *   2. The scarce resource here is literally the call. This vendor rations
 *      requests per minute per client id and reports the remaining quota in
 *      response headers. A unit of 'per-call' makes `Spend.units` a true count
 *      of the thing that is actually rationed, so the ledger stays a usable
 *      record of pressure on the limit even though every row costs $0.00.
 *
 * And if this API is ever priced — this vendor has priced its tiers before —
 * the change is one number in `usdPerUnit` and every Spend row already written
 * is counting the right unit. Under 'flat' they would all have to be discarded.
 *
 * ★ THE CONSEQUENCE NOBODY SHOULD BE SURPRISED BY: at $0 per unit,
 * `meter.mayspend(vendor, 0)` always passes, so `BudgetRefused` can never fire
 * on this source. The dollar meter cannot throttle a free vendor, and it is not
 * pretending to. The field that exists for this is `Budget.maxCalls`, which no
 * adapter in this repository reads today — see index.ts for why this one does
 * not either.
 */
const price = (endpoint: string): Price => ({
  vendor: VENDOR,
  endpoint,
  unit: 'per-call',
  usdPerUnit: 0,
  // Names the constraint that is real, since the dollar figure is not.
  unitName: 'request against a free, per-minute-rationed quota',
  // The date the ZERO was last checked, not the date it was assumed. This
  // vendor's free tier terms have changed twice; a price with no date on it is
  // a guess wearing a number.
  measuredAt: '2026-08-16',
});

/**
 * The token call is priced too, and that is deliberate. It is a real request to
 * a real host and it counts against us; leaving it out of the book would make
 * a token refresh a call that happened and cost nothing to look at, which is
 * how a refresh loop hides. Its price key is separate so the ledger can show
 * how much of the quota went on authentication rather than on reading.
 */
export const PRICES: PriceBook = {
  [`${VENDOR}:${LISTING}`]: price(LISTING),
  [`${VENDOR}:${INFO}`]: price(INFO),
  [`${VENDOR}:${TOKEN}`]: price(TOKEN),
};

/**
 * The published ceiling for an authenticated client, requests per minute,
 * averaged over a ten-minute window so short bursts are tolerated.
 *
 * ★ RECORDED AS A DOCUMENTED ASSUMPTION, NOT ENFORCED, and it is the LOWER of
 * two figures that disagree: the current data-API terms say 100/min for an
 * OAuth client id, while the older API wiki still says 60/min. Where two
 * numbers conflict and neither is measured, the smaller one is the one to
 * believe — but neither is the authority. The authority is the
 * `x-ratelimit-remaining` header the vendor puts on every response, which this
 * package reads and reports (see client.ts, `parseQuota`).
 *
 * This client neither retries, caches, nor paces, for the same reason the meter
 * does not: those change what the vendor is asked, and pacing decided inside a
 * client is pacing nobody above it can see or budget for.
 */
export const RATE_LIMIT_PER_MIN = 60;
