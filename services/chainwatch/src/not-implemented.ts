/**
 * Work that is genuinely future, marked so it shows up in the run log rather
 * than only in the file. See services/runner/src/not-implemented.ts for the
 * reasoning; it is duplicated for the same reason the logger is.
 */
export class NotImplemented extends Error {
  constructor(what: string) {
    super(`not implemented: ${what}`);
    this.name = 'NotImplemented';
  }
}
