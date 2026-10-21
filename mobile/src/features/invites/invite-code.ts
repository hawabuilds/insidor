/**
 * AN INVITE CODE ON ITS WAY IN: read from an invite link (insidor.app/i/<CODE>) or typed at the
 * door, and kept on this phone until the person has signed in and the code is brought to the
 * server. Pure parsing beside a few storage calls, so the rules run under `node --test`.
 *
 * ★ THE LINK IS TURNED INTO THE APP'S OWN ADDRESS BEFORE THE FIRST FRAME. `/i/<CODE>` is a path,
 * and the app routes by the hash; main.tsx keeps the code and puts the address back to `/`, so the
 * router never sees a path it does not know and a reload does not ask for the code again.
 *
 * ★ A KEPT CODE IS A CONVENIENCE, NOT ACCESS. Storage can be cleared or blocked; then the code box
 * is simply empty again. Only the server's answer lets anyone in.
 *
 * What breaks if changed carelessly: `cleanCode` must clean exactly as services/social invites.ts
 * `codeOf` does, or a code that works on the server is refused here before it is ever sent.
 */

const KEY = 'insidor.invite';

/** A code as typed or linked, cleaned the way the server stores codes; null when it cannot be one. */
export function cleanCode(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{4,32}$/.test(c) ? c : null;
}

/** The code in an invite link's path (`/i/<CODE>`), or null for any other path. */
export function codeFromPath(pathname: string): string | null {
  const m = /^\/i\/([^/]+)\/?$/.exec(pathname);
  if (m?.[1] === undefined) return null;
  try {
    return cleanCode(decodeURIComponent(m[1]));
  } catch {
    return null;
  }
}

/** The link a member shares: this app's own address, so a preview build shares its own. */
export const inviteLink = (origin: string, code: string): string => `${origin.replace(/\/+$/, '')}/i/${encodeURIComponent(code)}`;

export function pendingCode(): string | null {
  try {
    const v = globalThis.localStorage?.getItem(KEY) ?? null;
    return v === null ? null : cleanCode(v);
  } catch {
    return null;
  }
}

export function keepCode(code: string | null): void {
  try {
    if (code === null) globalThis.localStorage?.removeItem(KEY);
    else globalThis.localStorage?.setItem(KEY, code);
  } catch {
    /* Storage refused: the code box is empty next time, which is the honest fallback. */
  }
}

/** Before the first frame: an invite link's code is kept and the address put back to the app's own. */
export function takeInviteLink(loc: { readonly pathname: string; readonly hash: string }, replace: (url: string) => void): string | null {
  const code = codeFromPath(loc.pathname);
  if (code === null) return null;
  keepCode(code);
  replace(`/${loc.hash}`);
  return code;
}
