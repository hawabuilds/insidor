/**
 * THE LAST NOTIFICATIONS READ, KEPT FOR THE NEXT OPEN, AND WHEN TO ASK AGAIN AFTER A FAILED READ.
 * Pure, so `node --test` holds the rules; list.ts does the reading.
 *
 * ★ A FAILED READ IS NOT A BLANK SCREEN. On 2026-10-21 the alert service's process died when the
 * database dropped an idle connection and was down for about nine minutes, and every open of
 * Notifications in that time replaced the list with "Could not load your notifications". What was
 * read a minute earlier was still true. So the list read last in this page's life is kept per
 * person and per list, shown at once on the next open while the new read is out, and kept on screen
 * when that read fails; the read is asked again quietly (`retryDelayMs`) until it lands. The error
 * line is said only when there is nothing read to show.
 *
 * ★ KEPT PER PERSON, IN MEMORY ONLY. The key is the signed-in person (the session token's subject),
 * so signing in as someone else on the same phone never shows the last person's rows, and nothing
 * personal is written to the phone's storage: a reload starts from a read, as before.
 *
 * What breaks if changed carelessly: the subject is read from the token without checking it. That is
 * safe only because it picks a slot in this page's own memory; it must never be sent or trusted as
 * who someone is (the services check the token itself).
 */

/** The `sub` of a JWT, unverified: which slot of this page's memory to use. Null when it is not one. */
export function tokenSubject(token: string | null): string | null {
  if (token === null) return null;
  const part = token.split('.')[1];
  if (part === undefined || part === '') return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' && sub !== '' ? sub : null;
  } catch {
    return null;
  }
}

/** The quiet retries after a failed read: soon, then less often, then once a minute while the screen is open. */
const RETRY_STEPS_MS = [3_000, 10_000, 30_000] as const;
const RETRY_EVERY_MS = 60_000;
export const retryDelayMs = (failures: number): number => RETRY_STEPS_MS[Math.max(0, failures - 1)] ?? RETRY_EVERY_MS;

/** The last list read, per person and list. */
export function listKeeper<T>() {
  const kept = new Map<string, T>();
  const slot = (who: string | null, key: string): string | null => (who === null ? null : `${who}\n${key}`);
  return {
    get: (who: string | null, key: string): T | null => {
      const s = slot(who, key);
      return s === null ? null : (kept.get(s) ?? null);
    },
    set: (who: string | null, key: string, value: T): void => {
      const s = slot(who, key);
      if (s !== null) kept.set(s, value);
    },
  };
}
