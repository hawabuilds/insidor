/**
 * Reconnect backoff for a source that has stopped answering.
 *
 * WHY EQUAL JITTER RATHER THAN NO JITTER OR FULL JITTER. No jitter means every
 * instance and every restart retries on the same schedule, so a vendor coming
 * back from an outage is hit by a synchronised wall of clients and goes down
 * again. Full jitter (uniform over [0, ceiling]) fixes that but produces near
 * zero delays often enough to matter when the failure is a rate limit — which
 * is the failure we actually see, not a hard outage. Equal jitter keeps half
 * the delay deterministic and randomises the other half, so the retry is both
 * spread out and never immediate.
 *
 * The function is pure and takes its randomness as an argument, so the tests
 * assert exact numbers rather than ranges.
 */

export interface BackoffOptions {
  /** The delay after the first failure, before jitter. */
  readonly baseMs: number;
  /** The ceiling. Beyond this, patience is not the answer; the watchdog is. */
  readonly maxMs: number;
}

/**
 * @param attempt  1 for the first failure. 0 or less means "not failing", which
 *                 is not a backoff situation and returns 0 rather than a base
 *                 delay — a caller that is healthy must not be slowed down.
 * @param random   in [0, 1). Injected.
 */
export function backoffDelayMs(attempt: number, opts: BackoffOptions, random: number): number {
  if (attempt <= 0) return 0;
  // Cap the exponent before the shift so a long outage cannot overflow into
  // Infinity and then into a NaN delay.
  const exponent = Math.min(attempt - 1, 30);
  const ceiling = Math.min(opts.maxMs, opts.baseMs * 2 ** exponent);
  const half = ceiling / 2;
  return Math.round(half + random * half);
}
