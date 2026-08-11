/**
 * The marker for work that is genuinely future, as opposed to work that was
 * forgotten.
 *
 * WHY a named error rather than a `TODO` comment or a silent default: a stage that
 * has not been built must be indistinguishable from a stage that is broken, because
 * both are "we cannot decide this" and both must stop the caller. The failure mode
 * this forecloses is the one the previous build shipped everywhere — a placeholder
 * that returned a plausible zero, which downstream read as real evidence.
 *
 * Every throw site names the file that must exist and what it must compute, so the
 * developer filling it in does not have to reconstruct the intent from the spec.
 */

export class NotImplemented extends Error {
  constructor(what: string) {
    super(`not implemented: ${what}`);
    this.name = 'NotImplemented';
  }
}

/** Returns `never`, so a stub body typechecks against any declared return type. */
export function notImplemented(what: string): never {
  throw new NotImplemented(what);
}
