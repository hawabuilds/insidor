/**
 * A MarketState, as a row that can be stored — which means: with the reason
 * attached wherever there is no number.
 *
 * Pure. No clock, no database, no vendor. Every input arrives as an argument, so every
 * rule below is a unit test rather than an integration test, and this file is where the
 * whole service's judgement lives.
 *
 * ★ WHY THIS TRANSLATION EXISTS AT ALL, rather than the row being spelled straight off
 * the MarketState. `MarketState` carries one nullable number per quantity and has
 * nowhere to record WHY a null is null — the adapter says so itself, in the comment on
 * its own `nonNegative` helper. That is tolerable in a value passing through memory and
 * intolerable in a stored row, because the row outlives the call that made it and
 * becomes the only surviving evidence of what the venue actually said. Three facts
 * arrive in the same shape and must not stay in it:
 *
 *   - the venue reported no market for this coin at all           → no_market
 *   - a market exists and does not carry this number              → not_reported
 *   - a value arrived and could not be read as this quantity      → unreadable
 *
 * The distinguishing bit is `depth`, and only `depth`. It is null exactly when the
 * mapper found no pair to price from, which is the venue's own way of saying "I have
 * never heard of this token" — and that is a completely different claim from "this
 * pool has no liquidity object", which is what a curve returns and which is the
 * absence the entire product is built to serve. Reading them off the same null is the
 * bug that deleted the pre-graduation population from the build this replaces.
 *
 * NOTHING HERE PRODUCES A ZERO FROM AN ABSENCE, and nothing may. A price of 0 says the
 * coin is worthless; `no_market` says nobody has traded it. Those are opposite claims
 * about the same coin, and the second one is the ordinary state of everything on this
 * board in its first hour.
 */

import { assetKey } from '@insidor/contracts';
import type {
  AssetRef,
  MarketAbsenceReason,
  MarketCapBasis,
  MarketState,
  Millis,
} from '@insidor/contracts';

/**
 * A number the market gave, or the venue's own statement of why it did not.
 *
 * A two-branch union rather than `number | null` plus a loose reason field, for the
 * reason `Rate` is one in contracts: a `number | null` is precisely the shape that
 * lets a caller skip the absent case and get a plausible zero, and `.value` does not
 * typecheck here until the read branch has been proved. The database says the same
 * thing a second time, with the four `*_xor_reason` constraints in 0010.
 */
export type ReadNumber =
  | { readonly kind: 'read'; readonly value: number }
  | { readonly kind: 'absent'; readonly why: MarketAbsenceReason };

/** One row of public.market_reading, in this package's vocabulary. */
export interface MarketReading {
  readonly chain: string;
  readonly address: string;
  readonly assetKey: string;
  readonly venueId: string;
  /** When the reading was TAKEN. Never `now`, never the moment of the insert. */
  readonly takenAt: Millis;

  readonly priceUsd: ReadNumber;
  readonly marketCapUsd: ReadNumber;
  /** Non-null exactly when the cap was read. Never guessed, never carried forward. */
  readonly marketCapBasis: MarketCapBasis | null;
  readonly liquidityUsd: ReadNumber;
  readonly priceChange24hPct: ReadNumber;

  /** See `quotableBy` below. A read-only venue can never make this true. */
  readonly tradable: boolean;
  readonly quotedBy: string | null;

  readonly sourceVendor: string;
  readonly sourceEndpoint: string;
}

/**
 * The quantities that cannot be negative. The 24-hour change is deliberately not one
 * of them: a fall is the whole point of a signed field, and pointing a non-negativity
 * guard at it would silently delete every coin that dropped, leaving a board on which
 * nothing ever goes down.
 */
function quantity(value: number | null, whenAbsent: MarketAbsenceReason): ReadNumber {
  if (value === null) return { kind: 'absent', why: whenAbsent };
  /* A value that arrived and is not a number is `unreadable` and not `whenAbsent`.
     The adapter already refuses non-finite and negative readings, so this fires only
     if that guard is ever relaxed — which is exactly when a silent zero would cost
     the most. Defence at the boundary that stores, as well as at the one that parses. */
  if (!Number.isFinite(value) || value < 0) return { kind: 'absent', why: 'unreadable' };
  return { kind: 'read', value };
}

/** The same, for a signed quantity: negative is a reading, not a fault. */
function signedQuantity(value: number | null, whenAbsent: MarketAbsenceReason): ReadNumber {
  if (value === null) return { kind: 'absent', why: whenAbsent };
  if (!Number.isFinite(value)) return { kind: 'absent', why: 'unreadable' };
  return { kind: 'read', value };
}

/**
 * Whether this venue would actually QUOTE the coin — which is the only thing that may
 * ever make a row `tradable`.
 *
 * ★ IT IS NOT DERIVED FROM ANY NUMBER IN THE READING, and the temptation to derive it
 * from liquidity is the specific mistake contracts/src/asset.ts forbids by name:
 * "Nothing anywhere may gate on liquidityUsd. The gate is quotability." A curve with
 * no reserve object is perfectly tradable; a pool with a large reserve can be
 * unquotable because the token freezes transfers. Liquidity answers neither question.
 *
 * A venue that does not implement `trade` cannot be asked, so there is no quote, so
 * there is nothing to stand behind — and 0010's `tradable_requires_a_quoting_venue`
 * makes that a constraint rather than a habit. The market data vendor this service
 * reads through declares `read` and nothing else, deliberately, so this returns null
 * for every reading it writes today. That is honest and not pessimistic: the honest
 * render of "nobody has been asked" is no Buy affordance at all.
 */
export function quotableBy(venue: { readonly trade?: unknown; readonly id: unknown }): string | null {
  return venue.trade === undefined ? null : String(venue.id);
}

export interface ReadingContext {
  /** The venue that answered, as an id. Never the vendor we bought the reading from. */
  readonly venueId: string;
  /**
   * The venue that would fill an order for this coin, when one was actually asked.
   * null is the ordinary answer and forces `tradable` false — see `quotableBy`.
   */
  readonly quotedBy: string | null;
}

export function toReading(state: MarketState, ctx: ReadingContext): MarketReading {
  /**
   * ★ THE ONE BIT EVERY ABSENCE REASON BELOW IS DERIVED FROM.
   *
   * `depth` is null exactly when the mapper found no pair to price from — the venue
   * has no market for this coin. Anything else means we are looking at a real market
   * that simply did not carry the field being asked about. Using `priceUsd === null`
   * for this instead would be wrong in the case that matters: a pair can exist and
   * report no price, and calling that "no market" would tell a user a coin they can
   * see trading does not trade.
   */
  const whenAbsent: MarketAbsenceReason = state.depth === null ? 'no_market' : 'not_reported';

  const priceUsd = quantity(state.priceUsd, whenAbsent);
  const liquidityUsd = quantity(state.liquidityUsd, whenAbsent);
  const priceChange24hPct = signedQuantity(state.priceChange24hPct, whenAbsent);

  /* A cap whose basis the venue did not state is a number whose meaning is missing.
     The two bases differ by more than a factor of ten on a coin with most of its
     supply still locked, so publishing the figure under a guessed basis would put a
     $10M label on an $800k coin — and picking one is exactly the guess the basis field
     exists to prevent. So the cap goes with it: unreadable, with no number. 0010's
     `basis_iff_cap` says the same thing from the database's side. */
  const capRead = quantity(state.marketCapUsd, whenAbsent);
  const marketCapUsd: ReadNumber =
    capRead.kind === 'read' && state.marketCapBasis === null
      ? { kind: 'absent', why: 'unreadable' }
      : capRead;
  const marketCapBasis = marketCapUsd.kind === 'read' ? state.marketCapBasis : null;

  const ref: AssetRef = state.asset;

  return {
    chain: String(ref.chain),
    address: ref.address,
    assetKey: String(assetKey(ref)),
    venueId: ctx.venueId,
    /* MarketState.observedAt, not the moment of the write. The projector's freshness
       rule is enforced against this column, so a reading that says "now" when it means
       "twenty minutes ago" would defeat the whole staleness guarantee from inside. */
    takenAt: state.observedAt,

    priceUsd,
    marketCapUsd,
    marketCapBasis,
    liquidityUsd,
    priceChange24hPct,

    tradable: ctx.quotedBy !== null,
    quotedBy: ctx.quotedBy,

    /* Provenance, kept so a disagreement between two vendors is diagnosable. It never
       leaves the store: the projector's SELECT does not list these two columns, and a
       column that is not in the result set cannot reach a payload by accident. */
    sourceVendor: state.source.vendor,
    sourceEndpoint: state.source.endpoint,
  };
}

/** The number, or null — the shape a parameterised INSERT wants. Never a zero. */
export const numberOf = (n: ReadNumber): number | null => (n.kind === 'read' ? n.value : null);

/** The reason, or null. Exactly one of this and `numberOf` is non-null, always. */
export const reasonOf = (n: ReadNumber): MarketAbsenceReason | null =>
  n.kind === 'absent' ? n.why : null;
