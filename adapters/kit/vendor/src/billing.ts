/**
 * A SUPPLIER THAT REFUSED A CALL FOR BILLING: out of credit, over a plan's usage limit, a
 * payment required. One typed error for every vendor, and one process-wide place it is told to.
 *
 * WHY ITS OWN ERROR. On the day the judge's account ran dry, every call came back as a plain
 * "unavailable", the callers turned that into an absent answer as they should, and the runner
 * scored nothing for half an hour while every log line read as a quiet minute. An empty account
 * and a vendor having a bad minute are different facts: the second heals itself, the first waits
 * for a person to top it up. `OutOfCredit` IS a `VendorUnavailable`, so every caller that already
 * degrades on an outage keeps doing exactly that — nothing fails harder — but anything that asks
 * can tell the two apart.
 *
 * WHY A PROCESS-WIDE HOOK AND NOT ONLY A THROW. The callers are right to swallow an outage (a
 * judge failure is a per-post `unavailable`, an embedding failure degrades, a discovery failure is
 * "source failed"), and teaching each of them to rethrow one kind of error is how the next caller
 * forgets to. So the error reports itself when it is BUILT, at the vendor edge: `outOfCredit`
 * tells every listener the runner wired in (`onOutOfCredit`), then returns the error to be thrown.
 * Whatever a caller does with it afterwards, the owner has already been told. `vendorAnswered`
 * is the same hook for the other direction: a vendor that answers a call again.
 *
 * ★ THE MESSAGE IS OURS, NEVER THE VENDOR'S BODY. Each client classifies the vendor's own signal
 * (a status, an error type, a phrase) into a short fixed reason it wrote itself. A body can carry
 * an account id, an organisation name or an echoed key, and this message goes to a log and to a
 * phone's lock screen.
 *
 * What breaks if changed carelessly: a listener that throws. Listeners are called inside a
 * client's error path; one that throws would replace the billing error with its own, so each
 * call is wrapped and a listener's failure is dropped.
 */

import { VendorUnavailable } from './errors.ts';

/** The vendor refused the call because its account cannot pay for it. Not retried, not a shape error. */
export class OutOfCredit extends VendorUnavailable {
  /** A short, fixed, secret-free reason the client chose: "credit balance too low", "monthly usage limit reached". */
  readonly reason: string;

  constructor(vendor: string, endpoint: string, reason: string, status?: number) {
    super(vendor, endpoint, `refused for billing: ${reason}`, status);
    this.name = 'OutOfCredit';
    this.reason = reason;
  }
}

export interface BillingListener {
  /** A vendor refused a call for billing. */
  readonly refused?: (error: OutOfCredit) => void;
  /** A vendor answered a call successfully (cheap; called on every success). */
  readonly answered?: (vendor: string) => void;
}

const listeners = new Set<BillingListener>();

/** Listen for billing refusals and answers in this process; returns the unsubscribe. */
export function onOutOfCredit(listener: BillingListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Build the billing error and tell every listener; the caller throws what this returns. */
export function outOfCredit(vendor: string, endpoint: string, reason: string, status?: number): OutOfCredit {
  const error = new OutOfCredit(vendor, endpoint, reason, status);
  for (const l of listeners) {
    try {
      l.refused?.(error);
    } catch {
      /* A listener's failure must never replace the billing error. */
    }
  }
  return error;
}

/** A vendor answered a call. Lets a listener say an account that was refused is working again. */
export function vendorAnswered(vendor: string): void {
  for (const l of listeners) {
    try {
      l.answered?.(vendor);
    } catch {
      /* As above. */
    }
  }
}

/** True for a billing refusal. */
export function isOutOfCredit(error: unknown): error is OutOfCredit {
  return error instanceof OutOfCredit;
}
