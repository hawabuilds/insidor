/**
 * Whether this browser has been let in before: signed in once, or walked in on a build with no
 * sign-in. Read on the first render so a returning person never sees the front door flash before
 * their session comes back — Trador's signed-in hint.
 *
 * A convenience, not a lock: storage can be cleared or blocked, and then the front door simply
 * shows again.
 */

const KEY = 'insidor.entered';

export function hasEntered(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function markEntered(): void {
  try {
    globalThis.localStorage?.setItem(KEY, '1');
  } catch {
    /* Storage refused: the door shows again next time, which is the honest fallback. */
  }
}

/** The front door is for the bare address only: a shared story or coin link always opens straight in. */
export function showsLanding(hash: string, entered: boolean, signedIn: boolean): boolean {
  const bare = hash === '' || hash === '#' || hash === '#/';
  return bare && !entered && !signedIn;
}
