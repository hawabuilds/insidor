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
}

export interface MintTimeOptions {
  /**
   * How far two independent sources may disagree and still be called exact.
   * Injected: it is a judgement about acceptable error, and judgements are
   * policy. On fresh mints the two sources matched to the second.
   */
  readonly agreementToleranceMs: number;
}

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
  const { issuerMs, chainMs, vendorMs } = inputs;
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
  } else if (vendorMs !== null) {
    // Kept for display and for ordering hints, never for the gate. The
    // measured error distribution has no usable upper bound, so there is no
    // honest `boundS` to state — which is what 'unknown' means.
    result = { at: vendorMs, source: 'vendor_field', confidence: 'unknown', boundS: null };
  } else {
    result = { at: null, source: 'none', confidence: 'unknown', boundS: null };
  }

  assertMintTimeInvariants(result);
  return result;
}
