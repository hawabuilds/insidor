/**
 * The marker for work that is genuinely ahead of us.
 *
 * A distinct class rather than a bare `throw new Error('todo')`, so an unfinished path is
 * greppable, catchable, and distinguishable at runtime from a real failure. A UI that shows
 * "something went wrong" when it means "nobody has written this yet" wastes an afternoon
 * every time.
 *
 * ★ A COPY OF `app/src/shared/not-implemented.ts`, KEPT IN STEP BY HAND. The phone app may not import the desktop
 * app (.dependency-cruiser.cjs, `mobile-cannot-reach-the-logic`), and this file is small and
 * load-bearing enough that a second package for it would cost more than the copy. If one of
 * the two changes, change both.
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
