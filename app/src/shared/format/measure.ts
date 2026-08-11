/**
 * MISSING DATA, AS A TYPE.
 *
 * A brand-new coin has no price, no market cap and no liquidity, and a brand-new story may
 * have no readable counter yet. That is the COMMON case on this product, not an edge case:
 * the thing we sell is naming the real coin while it is still climbing, so most of what the
 * screen shows is young enough to be incomplete.
 *
 * The previous build modelled all of that as `number`, defaulted the absences to 0, and
 * rendered a missing timestamp as an age of 0 — "brand new" — on a product whose entire
 * pitch is earliness. That is the worst possible direction to fail in: it makes the oldest,
 * least-known rows look like the freshest ones.
 *
 * So absence is not a number here. `Measured` is a two-branch union and the absent branch
 * has NO numeric member at all. There is deliberately no `valueOr(default)`, no `?? 0`, no
 * `toNumber()`: a caller that wants a number out of an unknown has to write the zero itself,
 * in its own file, where a reviewer can see it. Nothing in this directory will do it for them.
 *
 * This module imports nothing. It is the leaf everything else in the app is spelled against.
 */

/** Epoch milliseconds. Never a Date — a Date is mutable and is not JSON. */
export type Millis = number;

/**
 * Why a number is not here. Closed list, because the pending state gets a real visual
 * treatment per reason and a free-text reason cannot be given one.
 *
 * These are the user's reasons, not ours. `not_read_yet` says nothing about which stage is
 * behind; `not_reported` says nothing about which platform withholds it.
 */
export type PendingReason =
  /** Nothing has been minted from this story, so there is no market to have a number in. */
  | 'not_minted'
  /** Minted, but nothing is quotable yet — there is no price because nobody has traded. */
  | 'no_market'
  /** We simply have not read it yet. The commonest case in the first minutes. */
  | 'not_read_yet'
  /** The source has no such concept. Distinct from zero: absence is not a value of zero. */
  | 'not_reported'
  /** We read something and it did not make sense — out of range, backwards, malformed. */
  | 'unreadable';

/** A number we actually have, or an honest statement that we do not. */
export type Measured =
  | { readonly known: true; readonly amount: number }
  | { readonly known: false; readonly pending: PendingReason };

/** An instant we actually have, or an honest statement that we do not. */
export type Instant =
  | { readonly known: true; readonly at: Millis }
  | { readonly known: false; readonly pending: PendingReason };

/**
 * A signed change. Split from `Measured` because the UI treats it differently — it is the
 * one field allowed to carry colour, and only by SIGN. See ui/Delta.tsx.
 */
export type Delta =
  | { readonly known: true; readonly amount: number }
  | { readonly known: false; readonly pending: PendingReason };

/* ── constructors ─────────────────────────────────────────────────────── */

export function known(amount: number): Measured {
  /* A non-finite number is not a number we have. Letting NaN through as `known` would put
     "NaN" on the board, which is the same failure as putting 0 there, only louder. */
  if (!Number.isFinite(amount)) return { known: false, pending: 'unreadable' };
  return { known: true, amount };
}

export function pending(reason: PendingReason): Measured {
  return { known: false, pending: reason };
}

export function instant(at: Millis): Instant {
  if (!Number.isFinite(at)) return { known: false, pending: 'unreadable' };
  return { known: true, at };
}

export function pendingInstant(reason: PendingReason): Instant {
  return { known: false, pending: reason };
}

/**
 * The ONE bridge from JSON into this vocabulary.
 *
 * `null` in a payload becomes a pending value carrying the reason the server gave. It never
 * becomes 0, and there is no overload of this function that lets it. Every decoder in
 * shared/api goes through here, so a server that starts sending nulls degrades into a
 * visible pending state rather than into a fabricated zero.
 */
export function measuredFrom(value: number | null | undefined, reason: PendingReason): Measured {
  return value === null || value === undefined ? pending(reason) : known(value);
}

export function instantFrom(value: Millis | null | undefined, reason: PendingReason): Instant {
  return value === null || value === undefined ? pendingInstant(reason) : instant(value);
}

export function deltaFrom(value: number | null | undefined, reason: PendingReason): Delta {
  return measuredFrom(value, reason);
}
