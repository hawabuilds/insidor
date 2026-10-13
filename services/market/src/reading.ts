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

  /** See `tradeAnswer` below: the trade service's route, never a number in this row. */
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
 * Where the trade service would route an order for this coin, as its own module says it
 * (adapters/venue/solana-pumpfun/src/route.ts `routeAfter`): the curve, the aggregator, no
 * route, or "could not tell". Spelled here as a plain union so this file stays free of the
 * module that reads the chain.
 */
export type TradeRoute = 'curve' | 'pool' | 'none' | 'unavailable';

/** The venue ids a route is recorded under, in `quoted_by`. */
export const ROUTE_VENUE = { curve: 'solana:curve', pool: 'solana:pool' } as const;

/** Whether the row says the coin can be traded, and who was asked. */
export interface TradeAnswer {
  readonly tradable: boolean;
  /** The venue that was asked and answered; null when nobody was, or nobody answered. */
  readonly quotedBy: string | null;
}

/**
 * The trade service's route, as the two columns 0010 keeps for it — which is the only thing
 * that may ever make a row `tradable`.
 *
 * ★ IT IS NOT DERIVED FROM ANY NUMBER IN THE READING, and the temptation to derive it
 * from liquidity is the specific mistake contracts/src/asset.ts forbids by name:
 * "Nothing anywhere may gate on liquidityUsd. The gate is quotability." A curve with
 * no reserve object is perfectly tradable; a pool with a large reserve can be
 * unquotable because the token freezes transfers. Liquidity answers neither question.
 *
 * ★ "NO ROUTE" AND "NOT ASKED" ARE DIFFERENT ROWS. `none` names the aggregator in
 * `quoted_by` beside `tradable = false`: it was asked and said no, a fact about the coin.
 * `unavailable` and a coin nobody asked (no chain access, over the pass's probe bound) leave
 * `quoted_by` null. Both render the same on a card — no Buy — but only the first may be
 * reused by a later pass (`reusableRoute`). 0010's `tradable_requires_a_quoting_venue`
 * holds either way: a `true` always carries the name of the venue that would fill it.
 */
export function tradeAnswer(route: TradeRoute | null): TradeAnswer {
  switch (route) {
    case 'curve':
      return { tradable: true, quotedBy: ROUTE_VENUE.curve };
    case 'pool':
      return { tradable: true, quotedBy: ROUTE_VENUE.pool };
    case 'none':
      return { tradable: false, quotedBy: ROUTE_VENUE.pool };
    default:
      return { tradable: false, quotedBy: null };
  }
}

/** A coin's latest stored answer, as `reusableRoute` reads it. */
export interface LastAnswer extends TradeAnswer {
  readonly takenAt: Millis;
}

/**
 * The aggregator's last answer for a coin off its curve, if it may stand in for asking again.
 *
 * ★ REUSED WITHIN A FIXED WINDOW OF THE CLOCK, NOT FOR "N MINUTES SINCE THE LAST ROW". Every
 * pass writes a new row, so "the last row is recent" would be true forever and one answer
 * would be carried along indefinitely. Instead the clock is cut into windows of `reuseMs`
 * (Policy.market.poolRouteReuseMs): an answer is reused only inside the window it was written
 * in, so every coin is asked again at least once per window and no answer is ever older than
 * one window. A coin the previous pass could not ask (over the bound, or an outage) has no
 * answer to reuse and is asked on the next pass.
 *
 * Only the aggregator's answers are reused. A curve's state is read on every pass: a curve
 * that has just finished cannot be traded on it, and the card must say so within one pass.
 */
export function reusableRoute(last: LastAnswer | undefined, nowMs: Millis, reuseMs: number): 'pool' | 'none' | null {
  if (last === undefined || last.quotedBy !== ROUTE_VENUE.pool) return null;
  if (Math.floor(last.takenAt / reuseMs) !== Math.floor(nowMs / reuseMs)) return null;
  return last.tradable ? 'pool' : 'none';
}

export interface ReadingContext {
  /** The venue that answered, as an id. Never the vendor we bought the reading from. */
  readonly venueId: string;
  /** The trade route's answer for this coin (`tradeAnswer`). */
  readonly trade: TradeAnswer;
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

    tradable: ctx.trade.tradable && ctx.trade.quotedBy !== null,
    quotedBy: ctx.trade.quotedBy,

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
