/**
 * ASSET and MARKET — chain-neutral, venue-neutral, vendor-neutral.
 *
 * Two shapes here exist because of measured bugs, not because of taste:
 *
 * 1. MINT TIME IS A STORED FACT WITH A SOURCE, NOT A DERIVED READ. Against a
 *    post-to-mint lag measured in single-digit minutes, an origin time from a
 *    market data vendor ran a median 22 minutes late and, in the tail, hours or
 *    weeks late — which silently REVERSES the ordering the pre-mint gate exists to
 *    enforce. Failing closed on null cannot catch that, because the failure is a
 *    confident wrong number, not a missing one. So confidence is carried, and a
 *    second-hand source may never claim 'exact'.
 *
 * 2. EVERY MARKET FIELD IS NULLABLE AND NULL IS NEVER ZERO. A bonding curve has no
 *    two-sided reserve, so vendors return no reserve object at all. The build this
 *    replaces coerced that absence to 0 and then rejected anything at 0 — turning a
 *    quality filter into a survivorship filter that removed essentially the entire
 *    pre-graduation population, which is the only population this product serves.
 *    Nothing anywhere may gate on `liquidityUsd`. The gate is quotability.
 */

import type { AssetKey, AssetRef, ChainId, VenueId } from './ids.ts';
import type { Millis } from './vocabulary.ts';

/* ── origin time ──────────────────────────────────────────────────────── */

export const MINT_TIME_SOURCES = [
  'issuer_api', // the issuing program's own list endpoint
  'chain_rpc', // the earliest signature against the address
  'vendor_field', // a market data vendor's field. Second-hand by definition.
  'none',
] as const;

export type MintTimeSource = (typeof MINT_TIME_SOURCES)[number];

/**
 * How well we know when this thing was minted. `bounded` is the member that earns its
 * place: it says "somewhere in this window", which is the honest answer when the only
 * evidence is the earliest signature we happened to index. Collapsing it into `exact`
 * would make an age comparison look sound when it is not, and collapsing it into
 * `unknown` would throw away a bound that is often good enough to rank on.
 */
export const MINT_TIME_CONFIDENCES = ['exact', 'bounded', 'unknown'] as const;

export type MintTimeConfidence = (typeof MINT_TIME_CONFIDENCES)[number];

/**
 * The invariant "a second-hand field can never be 'exact'" is also a database CHECK
 * constraint. It is stated in both places on purpose: the type stops it being
 * written, the constraint stops it being written by something that is not this code.
 */
export interface MintTime {
  readonly at: Millis | null; // null IS legal and means UNKNOWN
  readonly source: MintTimeSource;
  readonly confidence: MintTimeConfidence;
  /** Half-width of the bound, in seconds. Required when confidence is 'bounded'. */
  readonly boundS: number | null;
}

/* ── where the row came from ──────────────────────────────────────────── */

/**
 * ★ HOW THIS ROW CAME TO BE HERE — what kind of contact with the world produced it.
 *
 * THIS IS NOT `MintTimeSource` AND THE TWO ARE NOT INTERCHANGEABLE. The four sources
 * above answer "where did the TIME come from", which is a claim about the pedigree of
 * ONE FIELD. This answers "how did the ROW get into the table", which is a claim about
 * the row's relationship to reality. They are orthogonal, and the proof is in the data
 * rather than in the argument: a seed writing demonstration fixtures spans all four
 * mint-time sources — 'vendor_field' on some, 'chain_rpc' and 'issuer_api' on others,
 * 'none' on one — while the live socket writes only 'vendor_field'. So 'vendor_field'
 * means "invented OR observed" and the other three mean "invented" only by an accident
 * of which fixtures happen to exist this week. It cannot be made into a discriminator.
 *
 * ★ WHY THIS EXISTS AT ALL, stated as the bug it closes. A rail headed NEW LAUNCHES
 * served six coins that a seed script had written, under a heading asserting they had
 * just been minted, while 192 genuinely observed mints sat in the same table and never
 * appeared. Nothing was broken and nothing crashed: demonstration rows and observed
 * rows were the same row to every query in the system, because nothing anywhere recorded
 * the difference. The app has carried a permanent SAMPLE DATA banner over its fixtures
 * since the beginning for exactly this reason; that discipline had never reached the
 * database.
 *
 * ★ AND WHY IT IS A COLUMN AND NOT A SIDE TABLE. A row's origin is a property of the
 * row, is known at the instant of the INSERT, and has to be unforgeable-by-omission. A
 * join to a side table is a join a query can forget; a not-null column with no default
 * is one every writer must answer, and a writer that does not answer fails loudly on its
 * next run rather than quietly inheriting the convenient value.
 *
 * Each value names a KIND OF CONTACT. None of them names a vendor, a process, or a
 * venue — those would be answers to different questions and would rot at a different
 * rate.
 */
export const ASSET_ORIGINS = [
  /**
   * A push transport delivered this as it happened: we were connected and we heard it.
   * The instant is an arrival bounded by the observation lag, which is exactly why such
   * a row is ('vendor_field','bounded') and why that pair says nothing about origin.
   */
  'live_stream',
  /**
   * A listing or REST read returned it after the fact. Nobody was watching when it
   * happened; we asked later and it was there.
   *
   * ★ A DIFFERENT FACT FROM 'live_stream', AND THE DIFFERENCE IS LOAD-BEARING. A
   * backfilled row is evidence about the world but NOT evidence that we were watching,
   * so it must never be allowed to make a coverage log look covered.
   */
  'backfill',
  /**
   * A person typed it in. Real, believed, and traceable to a human rather than to a
   * transport — kept distinct from 'backfill' because the failure modes are opposite: a
   * transport fails systematically and a person fails one row at a time.
   */
  'operator',
  /**
   * Written by a seed or a demonstration tool. NEVER a claim about the world. This is
   * the value that makes a demo row sayable as what it is, and the value every surface
   * asserting observation must exclude.
   */
  'fixture',
  /**
   * ★ THE ROW PREDATES THIS COLUMN AND NO EVIDENCE RECOVERS ITS ORIGIN. Written by the
   * one-time backfill in store/migrations/0013_asset_origin.sql and by NOTHING ELSE,
   * EVER — store/src/migrations.test.ts asserts that no writer in the repository types
   * this string.
   *
   * It is deliberately NOT an "unknown" escape hatch, and three things keep it from
   * becoming one. The column has no default, so nobody inherits it. The name states a
   * historical fact rather than a state a new row could be in. And every surface that
   * asserts observation is an ALLOWLIST over the three origins above, so writing this
   * value costs you the row — the incentive runs in the safe direction.
   *
   * The alternative was to fold unclassifiable rows into 'live_stream', which is the
   * whole bug rebuilt inside the mechanism meant to fix it.
   */
  'unrecorded',
] as const;

export type AssetOrigin = (typeof ASSET_ORIGINS)[number];

/**
 * The origins that are a CLAIM ABOUT THE WORLD — the ones a surface may present as
 * something that actually happened.
 *
 * ★ IT IS AN ALLOWLIST AND THAT IS THE WHOLE POINT. The tempting spelling is
 * `origin <> 'fixture'`, which is a denylist, and a denylist admits every value added
 * after it was written — including 'unrecorded', which is precisely the value meaning
 * "we cannot vouch for this". A sixth origin arriving in a year is excluded by default
 * and included only by someone editing this line, which is the correct direction for a
 * rule whose failure mode is publishing a fiction as an observation.
 *
 * Note that 'backfill' IS here: a coin retrieved after the fact was still really minted.
 * What a backfilled row must not do is claim we were WATCHING, and that is a claim about
 * coverage rather than about the row.
 */
export const OBSERVED_ASSET_ORIGINS = ['live_stream', 'backfill', 'operator'] as const;

export type ObservedAssetOrigin = (typeof OBSERVED_ASSET_ORIGINS)[number];

/* ── the asset ────────────────────────────────────────────────────────── */

export interface Asset {
  readonly ref: AssetRef;
  readonly key: AssetKey;
  readonly chain: ChainId;
  /** The market it was first seen on. Assets migrate venues; this is where it began. */
  readonly venue: VenueId;

  /**
   * What kind of contact with the world produced this row. See ASSET_ORIGINS.
   *
   * There is no default here and there is none in the schema either: a writer that has
   * not thought about this fails, rather than silently certifying whatever it wrote as
   * an observation.
   */
  readonly origin: AssetOrigin;

  readonly mintedAt: MintTime;

  /**
   * OBSERVED, not an identifier. There is no unique constraint on this anywhere and
   * there never will be: one phrase can produce hundreds of assets with the same
   * symbol, so a symbol is a scoring channel over a time-bounded candidate set,
   * never the retrieval key.
   */
  readonly symbol: string | null;
  readonly name: string | null;
  readonly imageUri: string | null;
  readonly decimals: number | null;
  readonly creator: string | null;

  /** Links the issuer claims. Attacker-controlled — the field name says so. */
  readonly declaredSocial: Readonly<Record<string, string>>;

  readonly firstSeenAt: Millis;
}

/* ── what a market looks like right now ───────────────────────────────── */

/**
 * The two structurally different ways a market can exist. Not a cosmetic distinction:
 * a curve has no pooled reserve to quote against and a pool has no progress along
 * anything, so "how deep is this" is a different question with a different answer in
 * each. `Depth` below is the union that keeps them from being answered the same way.
 */
export const MARKET_CLASSES = ['bonding-curve', 'pool'] as const;

export type MarketClass = (typeof MARKET_CLASSES)[number];

/**
 * Which quantity a market capitalisation is a capitalisation OF.
 *
 * An array and not a bare union, because this list is also a CHECK constraint in
 * store/migrations/0010_market.sql and store/src/migrations.test.ts asserts the two
 * are the same list. A CHECK that has drifted from its union is the worst kind of
 * disagreement: it typechecks perfectly and fails at 3am on the first row of the kind
 * nobody wrote a test for.
 *
 * The two differ by orders of magnitude on a young asset — a coin with 8% of its
 * supply circulating is a $10M coin fully diluted and a $800k coin circulating — so
 * the basis travels with every cap and is never guessed. `null` basis is only legal
 * beside a `null` cap; see the biconditional in adapters/test/contract.
 */
export const MARKET_CAP_BASES = ['fully-diluted', 'circulating'] as const;

export type MarketCapBasis = (typeof MARKET_CAP_BASES)[number];

/**
 * What actually backs the price. The gates and the projection read THIS, never
 * `liquidityUsd` — the two market classes answer "can this be traded" in
 * structurally different ways, and flattening them is the bug described above.
 */
export type Depth =
  | {
      readonly kind: 'bonding-curve';
      /** [0,1] along the curve, or null when the venue does not expose it. */
      readonly progress: number | null;
      /** Slippage in basis points at fixed probe notionals. The honest depth measure. */
      readonly slippageBpsAt: Readonly<Record<'0.1' | '0.5' | '1.0', number | null>>;
    }
  | {
      readonly kind: 'pool';
      readonly liquidityUsd: number;
      readonly poolCount: number;
    }
  | null;

/** Coded, chain-neutral facts about whether a holding can be moved back out. */
export interface TransferRules {
  /** false when any required check could not be read. An unread rule is not a passed rule. */
  readonly complete: boolean;
  readonly hasTransferFee: boolean;
  readonly hasTransferHook: boolean;
  readonly issuanceRevoked: boolean | null;
  readonly freezeRevoked: boolean | null;
  /**
   * Which checks this venue requires, as codes. Carried so a chain that has no
   * concept of a given check reads as "not required" rather than "unknown forever",
   * which is what permanently suppresses a Buy affordance.
   */
  readonly requiredChecks: readonly string[];
  readonly failedChecks: readonly string[];
}

/**
 * One READING of one market at one instant, from one vendor. Not "the state of the
 * market" — the state of what a named endpoint said when we asked it.
 *
 * ★ EVERY QUANTITY ON IT IS NULLABLE AND THAT IS NOT DEFENSIVENESS. Each null is a
 * different absence with a different meaning: a curve has no `liquidityUsd`, a
 * forty-minute-old coin has no `priceChange24hPct`, a vendor that omits a field has no
 * cap basis. Substituting a zero for any of them turns "we do not know" into a claim
 * about the world — a zero liquidity reads as drained, a zero 24h change reads as flat
 * — and both are exactly the readings a gate would act on.
 *
 * `source` is on the value and not left to the caller for the same reason. Two vendors
 * disagreeing is routine; a disagreement you cannot attribute is a bug report nobody
 * can act on.
 */
export interface MarketState {
  readonly asset: AssetRef;
  readonly venue: VenueId;
  readonly observedAt: Millis;

  readonly priceUsd: number | null;
  readonly marketCapUsd: number | null;
  /** The venue says which basis it used. We never guess, and never mix the two. */
  readonly marketCapBasis: MarketCapBasis | null;

  /**
   * Change in the unit price over the trailing day, as a SIGNED PERCENTAGE — −7.86
   * means the price is 7.86% lower than it was a day ago. The unit is in the name
   * because the two plausible spellings differ by a factor of a hundred and neither
   * is self-evident from a number like `0.0786`.
   *
   * NULL is the ordinary case, not an error: a coin minted forty minutes ago has no
   * trailing day to have changed over. It is emphatically not a change of zero —
   * zero says the price held, which is a claim about a period nobody observed.
   *
   * It is a reading and not a difference we compute: nothing in this system stores a
   * price series to difference, so this is what the venue reports or nothing at all.
   */
  readonly priceChange24hPct: number | null;

  /** NULL on a curve. Absence is not illiquidity. NOTHING GATES ON THIS. */
  readonly liquidityUsd: number | null;
  readonly depth: Depth;

  /** Copied from the asset record, never derived from market data. */
  readonly mintedAt: MintTime;
  readonly transferRules: TransferRules | null;

  /** Provenance of this reading, so a disagreement between vendors is diagnosable. */
  readonly source: {
    readonly vendor: string;
    readonly endpoint: string;
    readonly fetchedAt: Millis;
  };
}

/**
 * Why a market number a reading tried to fill is not there.
 *
 * ★ THIS EXISTS BECAUSE A NULL WITH NO REASON IS INDISTINGUISHABLE FROM A NULL
 * NOBODY EVER TRIED TO FILL. `MarketState` above carries one nullable number per
 * quantity and has nowhere to record which of these happened — that is a tolerable
 * loss in a value passing through memory and an intolerable one in a stored row,
 * because the row outlives the call that made it and is the only surviving evidence
 * of what the venue actually said. So the store keeps the reason beside the number,
 * exactly as public.observation keeps a censor reason beside a rate, and 0010's
 * `..._xor_reason` constraints make "null with no reason" unwritable.
 *
 * Three, and only these three, because they are the three a ROW can be in:
 *
 *   no_market     the venue reported no market for this asset at all. Minted, not
 *                 yet traded — the common case here, not an edge case.
 *   not_reported  a market exists and does not carry this number. A curve has no
 *                 two-sided reserve to report a liquidity for; a coin an hour old
 *                 has no trailing day to report a change over. Absence of the
 *                 CONCEPT, which is not a value of zero.
 *   unreadable    a value arrived and could not be read as this quantity — a
 *                 negative reserve, a non-finite price.
 *
 * The two reasons deliberately NOT here are `not_minted` and `not_read_yet`. Both
 * are statements about the ABSENCE OF A ROW, and a row cannot make them about
 * itself. They are the projection's to make, from whether a reading exists at all
 * and how old it is.
 */
export const MARKET_ABSENCE_REASONS = ['no_market', 'not_reported', 'unreadable'] as const;

export type MarketAbsenceReason = (typeof MARKET_ABSENCE_REASONS)[number];

/* ── quoting ──────────────────────────────────────────────────────────── */

/**
 * Every kind of thing that can take money out of a trade, as a closed list.
 *
 * Closed on purpose: a `TradeQuote` renders its `costs` array and nothing else, so a
 * cost with no code here has nowhere to be displayed and cannot quietly become part of
 * a total the user never sees itemised. Adding a chain or a venue whose fee does not
 * fit one of these is a decision somebody makes here, in a diff, rather than a string
 * an adapter invents at runtime.
 */
export const TRADE_COST_CODES = [
  'network',
  'priority',
  'rent',
  'venue',
  'price-impact',
  'aggregator',
  'platform',
] as const;

export type TradeCostCode = (typeof TRADE_COST_CODES)[number];

/**
 * One line on the confirm sheet. Both `amountUsd` and `bps` are nullable because some
 * costs are only knowable as one or the other — a network fee is an amount and has no
 * meaningful rate, price impact is a rate and has no amount until the size is fixed —
 * and a quote that filled in the missing half by inventing a notional would be showing
 * the user a number no venue ever quoted.
 */
export interface TradeCost {
  readonly code: TradeCostCode;
  readonly label: string;
  readonly amountUsd: number | null;
  readonly bps: number | null;
  /** Per-cost, because some deposits come back and most fees do not. */
  readonly refundable: boolean;
}

/**
 * The quote is the shared artefact across chains; the executor is not. Measured
 * all-in cost ranged from under 2% to over 22% across three same-age assets, so a
 * confirm sheet renders THIS ARRAY and structurally cannot render a fixed fee line.
 *
 * Amounts are bigint: 1e18 exceeds 2^53 and a float here is silently lossy.
 */
export interface TradeQuote {
  readonly asset: AssetRef;
  readonly venue: VenueId;
  readonly side: 'buy' | 'sell';

  readonly inAmount: bigint;
  readonly outExpected: bigint;
  readonly outMinimum: bigint;
  readonly inDecimals: number;
  readonly outDecimals: number;
  readonly slippageBps: number;

  readonly costs: readonly TradeCost[];
  readonly allInBps: number;

  readonly expiresAt: Millis | null;
  readonly expiryReason: 'chain-nonce' | 'ttl' | 'none';

  /** NEVER cached — the venue changes underneath an asset when it graduates. */
  readonly route: readonly { readonly label: string }[];
}
