/**
 * The marker for work that is genuinely future, as opposed to work that is
 * missing by accident.
 *
 * WHY a named error class rather than a TODO comment: a `NotImplemented` thrown
 * inside a loop lands in `internal.stage_runs.err` through the ordinary
 * `finally` path, so an unfinished skeleton is VISIBLE in the same query that
 * shows a crashed stage. A TODO is visible only to whoever opens the file.
 */
export class NotImplemented extends Error {
  constructor(what: string) {
    super(`not implemented: ${what}`);
    this.name = 'NotImplemented';
  }
}
