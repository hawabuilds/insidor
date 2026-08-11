/**
 * The marker for work that is genuinely ahead of us.
 *
 * A distinct class rather than a bare `throw new Error('todo')`, so an unfinished path is
 * greppable, catchable, and distinguishable at runtime from a real failure. A UI that shows
 * "something went wrong" when it means "nobody has written this yet" wastes an afternoon
 * every time.
 */
export class NotImplemented extends Error {
  constructor(what: string) {
    super(`not implemented: ${what}`);
    this.name = 'NotImplemented';
  }
}

export function notImplemented(what: string): never {
  throw new NotImplemented(what);
}
