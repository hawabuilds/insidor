/**
 * THE OWNER'S LOW-CREDIT ALARM FOR THE OPEN-MODEL JUDGE'S ACCOUNT: every CREDIT_CHECK_MS (15 min)
 * the runner reads what is left on the account (the adapter's `accountCredits`, GET /credits) and
 * pushes once when it falls under the line, and once when it is topped up past it. The owner,
 * 2026-10-16: "push me ... if OpenRouter credit is low."
 *
 * ★ WHY IN THE RUNNER, NOT THE ALERT SERVICE. The runner already holds the account's key (it is
 * the one calling the judge) and already has the owner's supplier queue (billing-alerts.ts
 * `notice`), which the empty-account and short-video balance alerts use. Reading it from the alert
 * service would put a paid supplier's key in a second process for one number. If the runner is
 * down, nothing is spending the credit either; the outage alarm says the runner is down.
 *
 * ★ THE LINE: two days of the account's spend at the last day's rate, or CREDIT_FLOOR_USD ($5),
 * whichever is higher. Two days because a top-up waits for a person: a push at night is read in
 * the morning, and the account must still be paying then, with a day to spare for a weekend or a
 * card that needs confirming. The last day's spend (every endpoint on this vendor in the ledger —
 * the live judge, the shadow, the re-tune's learning book) because the account pays all of them,
 * and it follows the switch to the open model as its spend grows, with no number to retune. The
 * $5 floor because a quiet day says little about tomorrow: a re-tune alone has spent $2.37 on this
 * account in a night (2026-10-16), and a line of cents would fire only when it was already empty.
 *
 * ★ BACK only at CREDIT_CLEAR_RATIO (1.25×) the line: the line moves with the day's spend, and a
 * balance sitting at it must not push low, back, low as the day's rate wobbles. A top-up jumps far
 * past it.
 *
 * ★ ONCE. The low push's subject carries the UTC day it was first seen low, so a restart the same
 * day is dropped by the deliverer's claim; a balance still low after a restart on a later day is
 * said again that day (the short-video balance alert's rule). The back push carries the same day.
 *
 * An unread balance (the host down, a key without access to /credits) is logged and makes no claim
 * either way: it is never said as $0, and never clears a low. An unread day's spend falls back to
 * the floor alone and is logged.
 *
 * What breaks if changed carelessly: counting only the live judge's endpoint for the rate. The
 * learning book draws on the same account, twice a day in bursts; leave it out and the line is a
 * third of the real burn.
 */

import type { BillingAlerts } from './billing-alerts.ts';
import { errorText, type Logger } from './log.ts';

/** How often the balance is read. */
export const CREDIT_CHECK_MS = 15 * 60_000;
/** The line is never under this many dollars. */
export const CREDIT_FLOOR_USD = 5;
/** The spend the line is projected from: the account's last day. */
export const CREDIT_RATE_WINDOW_MS = 24 * 60 * 60_000;
/** The line is this many days of the last day's spend. */
export const CREDIT_DAYS = 2;
/** Back only at this multiple of the line. */
export const CREDIT_CLEAR_RATIO = 1.25;

const CENTS = 100;
const cents = (usd: number): number => Math.round(usd * CENTS) / CENTS;

/** The low line for a day's spend. */
export const creditLine = (dailyUsd: number): number => Math.max(CREDIT_FLOOR_USD, CREDIT_DAYS * Math.max(0, dailyUsd));

export interface CreditWatchDeps {
  readonly vendor: string;
  /** What is left on the account, in dollars; throws when it cannot be read. */
  readonly remaining: () => Promise<number>;
  /** The account's spend over the last day, in dollars; throws when it cannot be read. */
  readonly dailyUsd: () => Promise<number>;
  readonly alerts: Pick<BillingAlerts, 'notice'>;
  readonly log: Logger;
  readonly now: () => number;
}

/** The check, and its state (the UTC day it went low, or null) for a test to read. */
export function creditWatch(deps: CreditWatchDeps): { readonly check: () => Promise<void>; readonly lowSince: () => string | null } {
  let lowSince: string | null = null;
  return {
    lowSince: () => lowSince,
    async check() {
      let left: number;
      try {
        left = await deps.remaining();
      } catch (error) {
        deps.log.warn('the open judge account balance could not be read; no claim either way', { vendor: deps.vendor, err: errorText(error) });
        return;
      }
      let daily = 0;
      try {
        daily = await deps.dailyUsd();
      } catch (error) {
        deps.log.warn("the open judge account's day of spend could not be read; the line is the floor", { vendor: deps.vendor, err: errorText(error) });
      }
      const line = creditLine(daily);
      const facts = { usd: cents(left), lineUsd: cents(line), dailyUsd: cents(daily) };
      if (lowSince === null && left < line) {
        lowSince = new Date(deps.now()).toISOString().slice(0, 10);
        deps.alerts.notice(deps.vendor, `credit|${deps.vendor}|${lowSince}`, 'low', facts);
        return;
      }
      if (lowSince !== null && left >= CREDIT_CLEAR_RATIO * line) {
        deps.alerts.notice(deps.vendor, `credit|${deps.vendor}|back|${lowSince}`, 'topped', facts);
        lowSince = null;
      }
    },
  };
}
