/**
 * The four things that go wrong at the vendor edge, as distinguishable types.
 *
 * WHY these are types and not strings: RESOLVE's G7 gate must be able to tell
 * "this token is untradeable" from "our quote vendor is down" in one query. If
 * both arrive as `Error('failed')`, an outage looks like a market full of
 * untradeable tokens — or, worse, gets failed open and every candidate passes.
 */

/** A call whose wiring exists and whose vendor request is still future work. */
export class NotImplemented extends Error {
  /** The vendor request this would make. Named so the TODO is greppable. */
  readonly endpoint: string;

  constructor(endpoint: string, note?: string) {
    super(note === undefined ? `not implemented: ${endpoint}` : `not implemented: ${endpoint} — ${note}`);
    this.name = 'NotImplemented';
    this.endpoint = endpoint;
  }
}

/**
 * The vendor answered badly, or did not answer. Distinct from "the answer was
 * no": callers that fail closed need to know which of the two happened.
 */
export class VendorUnavailable extends Error {
  readonly vendor: string;
  readonly endpoint: string;
  /** HTTP status when there was one. Absent for timeouts and socket errors. */
  readonly status?: number;

  constructor(vendor: string, endpoint: string, note: string, status?: number) {
    super(`${vendor} unavailable at ${endpoint}: ${note}`);
    this.name = 'VendorUnavailable';
    this.vendor = vendor;
    this.endpoint = endpoint;
    if (status !== undefined) this.status = status;
  }
}

/**
 * The vendor answered, and the answer was not the shape we decoded against.
 * Types are erased at runtime, so `raw: unknown` proves nothing — this is the
 * error that turns a silent shape change into a loud one.
 */
export class VendorShapeError extends Error {
  readonly vendor: string;
  readonly field: string;

  constructor(vendor: string, field: string, note: string) {
    super(`${vendor}: ${field} ${note}`);
    this.name = 'VendorShapeError';
    this.vendor = vendor;
    this.field = field;
  }
}

/** The ledger refused the call before it was made. Not a vendor failure. */
export class BudgetRefused extends Error {
  readonly vendor: string;
  readonly endpoint: string;
  readonly reason: string;

  constructor(vendor: string, endpoint: string, reason: string) {
    super(`${vendor}/${endpoint} refused: ${reason}`);
    this.name = 'BudgetRefused';
    this.vendor = vendor;
    this.endpoint = endpoint;
    this.reason = reason;
  }
}
