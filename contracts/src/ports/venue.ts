/**
 * THE VENUE PORT — split by capability, because venues are not interchangeable.
 *
 * Two markets on one chain differ more from each other than two chains differ: one
 * is a curve with no two-sided reserve, the other is a pool. So the unit of variation
 * is the venue, not the chain, and a flat "chain adapter" would push that difference
 * into branches inside one file — the same failure this whole structure exists to fix.
 *
 * WHY the interface is four optional sub-interfaces rather than one with optional
 * methods: a venue that cannot trade should be unable to be asked, at compile time.
 * `venue.trade` being undefined is checkable; a `trade()` that throws at runtime is
 * a production incident. It is also how a new venue's read-only first month is
 * enforced by types rather than by a promise.
 *
 * WHAT GENERALISES AND WHAT DOES NOT: reads generalise almost for free; writes do
 * not. Execution differs in kind across chains — one has an expiring nonce, another
 * has a separate approval step — and a shared executor would have to invent each
 * concept for the chain that lacks it. So: two executors, one shared quote. The
 * quote is what the user is shown and what the product promises; the executor is
 * plumbing.
 */

import type {
  Asset,
  MarketState,
  MintTime,
  TradeQuote,
  TransferRules,
} from '../asset.ts';
import type { AssetRef, ChainId, VenueId } from '../ids.ts';
import type { Millis } from '../vocabulary.ts';
import type { Budget, Metered } from './meter.ts';

/**
 * What a venue can actually do, declared rather than discovered.
 *
 * Five capabilities and not one interface, because no venue has all five and a venue
 * that stubbed the ones it lacks would answer a question it cannot answer. The
 * declaration is DOUBLE: this array on `Venue.capabilities` says what is claimed, and
 * the optional sub-ports below say what is implemented. A caller must check both — the
 * array is what a planner reads before spending, the port is what it calls.
 */
export const VENUE_CAPABILITIES = ['watch', 'read', 'assess', 'trade', 'create'] as const;

export type VenueCapability = (typeof VENUE_CAPABILITIES)[number];

/** A newly created asset, as seen by whoever is watching for them. */
export interface MintEvent {
  readonly asset: Asset;
  readonly venue: VenueId;
  /** Carried with its source and confidence, never as a bare timestamp. */
  readonly mintedAt: MintTime;
  readonly seenAt: Millis;
}

/** watch — new assets appear here. Polled; there is no streaming requirement. */
export interface VenueWatch {
  /**
   * @param cursor durable and owned by the caller, so a restart is a resumption
   *        rather than a gap. A gap in this log makes an outcome label CENSORED
   *        rather than negative, which is a distinction the training set depends on.
   */
  since(cursor: string | null, budget: Budget): Promise<Metered<MintPage>>;
}

/**
 * A page of mints AND the interval it is a page OF. The second half is the point: an
 * empty `events` array means nothing without `coveredFrom`/`coveredTo`, because "no
 * mints happened" and "we did not look" are the same empty array. Coverage recorded
 * from these two fields is what later turns a label into `censored` rather than a
 * false negative.
 */
export interface MintPage {
  readonly events: readonly MintEvent[];
  readonly cursor: string;
  /** The interval this page actually covers, so coverage is provable, not assumed. */
  readonly coveredFrom: Millis;
  readonly coveredTo: Millis;
}

/** read — what a market looks like now. The cheap capability; it generalises. */
export interface VenueRead {
  state(asset: AssetRef, budget: Budget): Promise<Metered<MarketState>>;
  states(assets: readonly AssetRef[], budget: Budget): Promise<Metered<readonly MarketState[]>>;
}

/** assess — can a holding be moved back out. Coded reasons, never chain nouns. */
export interface VenueAssess {
  transferRules(asset: AssetRef, budget: Budget): Promise<Metered<TransferRules>>;
}

/**
 * trade — quoting and execution.
 *
 * Quotability is the gate, not liquidity: it is the only test that works identically
 * on a curve and on a pool, and it is the last gate to run because it is the only one
 * that costs a paid, rate-limited call.
 *
 * A quote failure MUST distinguish "this asset cannot be traded" from "our vendor is
 * down". Failing open means every candidate passes during an outage, and not
 * distinguishing the two is exactly what made the previous ingest death invisible.
 */
export interface VenueTrade {
  quote(request: QuoteRequest, budget: Budget): Promise<Metered<QuoteResult>>;
  /** Executes a quote that has not expired. Returns an opaque, chain-specific receipt. */
  execute(quote: TradeQuote, signer: Signer): Promise<TradeReceipt>;
}

export interface QuoteRequest {
  readonly asset: AssetRef;
  readonly side: 'buy' | 'sell';
  readonly inAmount: bigint;
  readonly slippageBps: number;
}

export type QuoteResult =
  | { readonly kind: 'quoted'; readonly quote: TradeQuote }
  /** The asset genuinely cannot be traded at this size right now. */
  | { readonly kind: 'unquotable'; readonly detail: string }
  /** OUR failure, not the market's. Fails closed and is counted separately. */
  | { readonly kind: 'unavailable'; readonly detail: string };

/**
 * Signing is entirely outside this port. The contract never sees a key, a seed or a
 * wallet — only an opaque handle a service resolved, so nothing in the vocabulary can
 * be the reason a secret got logged.
 */
export interface Signer {
  readonly accountRef: string;
  sign(payload: Uint8Array): Promise<Uint8Array>;
}

/**
 * What came back from submitting. `confirmedAt` and `filledOut` are nullable because
 * `submitted` is a real, common, long-lived state — a receipt is not a settlement, and
 * treating one as the other is how a fill gets counted that never happened. `ref` is
 * opaque and stays opaque: parsing it would put a chain's transaction format into a
 * layer that is not allowed to know chains exist.
 */
export interface TradeReceipt {
  readonly asset: AssetRef;
  readonly venue: VenueId;
  readonly submittedAt: Millis;
  readonly confirmedAt: Millis | null;
  /** Opaque chain-side identifier. Never parsed by core. */
  readonly ref: string;
  readonly filledOut: bigint | null;
  readonly status: 'submitted' | 'confirmed' | 'failed' | 'expired';
}

/**
 * One market, as the set of things it can do. The four sub-ports are OPTIONAL and that
 * is the design: a venue we can watch and read but not trade is a first-class venue,
 * not a broken one, and the type says so instead of a runtime `notImplemented` throw.
 *
 * `enabled` and `adjudicatedLabels` are both about not throwing history away. A venue
 * turned off keeps its rows, so its old labels stay joinable; a venue below the label
 * floor still produces decisions, but they are capped at `unsure` because a score
 * calibrated on other venues is not a score here.
 */
export interface Venue {
  readonly id: VenueId;
  readonly chain: ChainId;
  readonly market: 'bonding-curve' | 'pool';
  readonly capabilities: readonly VenueCapability[];
  /** A broken venue is DISABLED, not deleted — deletion loses its history and its labels. */
  readonly enabled: boolean;
  /**
   * How many of this venue's own adjudicated labels exist. Scores are not comparable
   * across venues, so a venue under the policy floor may produce 'unsure' at most.
   */
  readonly adjudicatedLabels: number;

  readonly watch?: VenueWatch;
  readonly read?: VenueRead;
  readonly assess?: VenueAssess;
  readonly trade?: VenueTrade;
}
