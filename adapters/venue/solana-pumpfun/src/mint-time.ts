/**
 * When the coin came into existence, and how much that answer can be trusted.
 *
 * This is the axis the whole product hangs on: the ordering gate asks whether
 * the post came before the mint, and the measured median gap is under four
 * minutes. A mint time that is confidently wrong by twenty minutes silently
 * REVERSES that gate — a post made after the mint passes as pre-mint — and no
 * amount of failing-closed on null catches it, because the failure mode is a
 * confident wrong number rather than a missing one.
 *
 * So mint time is never a derived read. It is three inputs and a rule:
 *
 *   issuer_api     the issuing program's own creation timestamp. Present on
 *                  every fresh mint we sampled.
 *   chain_rpc      the oldest signature's block time. Independent of the venue.
 *   vendor_field   a market-data aggregator's pair-creation time. NEVER exact:
 *                  measured against the issuer's own record, the median lag
 *                  was +22 minutes and the tail ran to thousands of hours,
 *                  because the aggregator drops the original curve pair after
 *                  migration and the earliest surviving pool is the migration
 *                  pool.
 *
 * A fourth input joined them when the mint feed became a push socket: the
 * instant a live notification REACHED US. It shares `vendor_field` with the
 * aggregator — both are second-hand — and it is 'bounded' where the aggregator
 * is 'unknown', because a relay hop has a measurable ceiling and a re-derived
 * origin does not. The rule below is the one place that distinction is made.
 *
 * The rule mirrors the database's CHECK constraints exactly, and this file
 * asserts them rather than assuming the database will catch it later — by then
 * the Buy button has already rendered.
 */

import type { Millis } from '@insidor/contracts';
import type { MintTime } from '@insidor/contracts/asset.ts';

export interface MintTimeInputs {
  /** The issuing program's own creation timestamp. */
  readonly issuerMs: Millis | null;
  /** Oldest signature block time from a generic RPC read. */
  readonly chainMs: Millis | null;
  /** A market aggregator's pair-creation field. Never authoritative. */
  readonly vendorMs: Millis | null;
  /**
   * The instant WE were told, live, that a creation had happened — a push
   * notification relayed by a third party that watches the chain for us.
   *
   * ★ THIS IS NOT A CREATION TIMESTAMP AND MUST NEVER BE STORED AS ONE. It is
   * an OBSERVATION time, and the only thing it proves is an upper bound: the
   * mint happened at or before this instant. What separates it from `vendorMs`
   * below — both are second-hand, both are `vendor_field` — is that the error
   * here has a measurable ceiling. It is one relay hop plus one confirmation,
   * which is seconds. `vendorMs` is an aggregator RE-DERIVING an origin from
   * whichever pool it can still see after migration, and that error was
   * measured at a +22 minute median with a tail to 9,743 hours: a distribution
   * with no usable upper bound, which is what makes it 'unknown' rather than
   * merely wide.
   *
   * So this one is 'bounded' and that one is 'unknown', and the difference is
   * not how much we like the source. It is whether an honest `boundS` exists.
   */
  readonly observedMs: Millis | null;
}

export interface MintTimeOptions {
  /**
   * How far two independent sources may disagree and still be called exact.
   * Injected: it is a judgement about acceptable error, and judgements are
   * policy. On fresh mints the two sources matched to the second.
   */
  readonly agreementToleranceMs: number;
  /**
   * The widest interval, in seconds, we are willing to claim a live observation
   * bounds: the mint is asserted to lie in [observedMs - lag, observedMs].
   *
   * Injected for the same reason as the tolerance above, and it is the more
   * dangerous of the two because it is the number that lets a socket event
   * become a comparable instant at all. Set it too wide and every candidate
   * fails gate G1 for having a bound wider than the lag it is measuring; set it
   * too narrow and the interval stops containing the truth, which does not
   * blur the ordering — it reverses it, silently, in our favour.
   */
  readonly observationLagS: number;
}

const MS_PER_SECOND = 1_000;

/** Mirrors the database CHECKs. Called on every value this module produces. */
export function assertMintTimeInvariants(m: MintTime): void {
  if (m.confidence === 'exact' && m.source !== 'issuer_api' && m.source !== 'chain_rpc') {
    throw new Error(`mint time: '${m.source}' can never be exact`);
  }
  if (m.confidence === 'bounded' && m.boundS === null) {
    throw new Error('mint time: bounded requires a bound width');
  }
  if (m.confidence !== 'unknown' && m.at === null) {
    throw new Error('mint time: a known confidence requires an instant');
  }
}

export function mintTime(inputs: MintTimeInputs, opts: MintTimeOptions): MintTime {
  const { issuerMs, chainMs, vendorMs, observedMs } = inputs;
  const boundS = Math.round(opts.agreementToleranceMs / 1000);

  let result: MintTime;

  if (issuerMs !== null && chainMs !== null) {
    const disagreement = Math.abs(issuerMs - chainMs);
    result =
      disagreement <= opts.agreementToleranceMs
        ? // Two independent sources, agreeing. This is the only way to earn
          // 'exact', and it is what a Buy affordance requires.
          { at: issuerMs, source: 'issuer_api', confidence: 'exact', boundS: null }
        : // They disagree. One of them is wrong and we cannot tell which, so
          // the answer is unknown — not an average, not the earlier one.
          { at: null, source: 'issuer_api', confidence: 'unknown', boundS: null };
  } else if (chainMs !== null) {
    result = { at: chainMs, source: 'chain_rpc', confidence: 'exact', boundS: null };
  } else if (issuerMs !== null) {
    // One source, unconfirmed. Allowed to be trusted within the tolerance we
    // would have used to confirm it, and no further.
    result = { at: issuerMs, source: 'issuer_api', confidence: 'bounded', boundS };
  } else if (observedMs !== null) {
    /*
     * ★ A LIVE OBSERVATION, CENTRED — and the centring is the whole of it.
     *
     * What we know is an upper bound: the mint happened at or before the
     * instant the notification reached us. So the claim is the interval
     * [observed - lag, observed], and `MintTime` states an interval as a
     * midpoint plus a HALF-WIDTH. Writing `at: observedMs` with
     * `boundS: lag` would be a different and false claim — that the mint may
     * have happened up to `lag` seconds in the FUTURE of the moment we were
     * told about it — and it would bias every stored mint time late by half
     * the lag, in the direction that makes a post look pre-mint. That is gate
     * G1 being reversed by an arithmetic convention.
     *
     * `ceil` rather than `round`, so an odd lag widens the interval rather
     * than narrowing it. The interval must contain the truth; being a second
     * too generous costs a candidate nothing, and being a second too tight
     * costs the ordering everything.
     *
     * The source is 'vendor_field' and not 'issuer_api'. The event is a relay's
     * forwarding of a program's emission, and a relay is second-hand by the
     * vocabulary's own definition — we are trusting its forwarding, its clock
     * and its completeness. Naming it 'issuer_api' would also make it
     * structurally eligible for 'exact' one refactor later, which is exactly
     * the door `exact_requires_real_source` exists to hold shut.
     */
    const halfWidthS = Math.ceil(opts.observationLagS / 2);
    result = {
      at: observedMs - halfWidthS * MS_PER_SECOND,
      source: 'vendor_field',
      confidence: 'bounded',
      boundS: halfWidthS,
    };
  } else if (vendorMs !== null) {
    // Kept for display and for ordering hints, never for the gate. The
    // measured error distribution has no usable upper bound, so there is no
    // honest `boundS` to state — which is what 'unknown' means. Note this is
    // the SAME source as the live observation above and a different confidence:
    // the source says who told us, the confidence says whether an honest bound
    // exists, and collapsing the two is how a re-derived origin time gets to
    // borrow a real one's credibility.
    result = { at: vendorMs, source: 'vendor_field', confidence: 'unknown', boundS: null };
  } else {
    result = { at: null, source: 'none', confidence: 'unknown', boundS: null };
  }

  assertMintTimeInvariants(result);
  return result;
}
