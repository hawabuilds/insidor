/**
 * THE AUTHOR HANDLES A URL-ADDRESSED SOURCE NEEDS TO RE-READ A POST, held for a synchronous read.
 *
 * The short-video source re-reads a post by its link, and the link needs the author's handle.
 * We hold it on the author row, but the adapter asks for it synchronously (`PlatformRuntime
 * .handles`) and cannot await a database. Until 2026-10-13 the runner answered null for every
 * post, so no short video was ever re-read: each run was skipped as unaddressable and its rows
 * carried out with nothing read ("asked=1 answered=0 usd=0" in the log). TRACK now fills this
 * from the store just before it asks the source (stages.ts `applyAll`), and the runner's
 * runtime reads it (wiring.ts).
 *
 * Its own file because two places share one instance: the runtime built once in wiring.ts, and
 * TRACK, which wiring builds separately. A module-level map is that one instance.
 *
 * What breaks if changed carelessly: a handle must only ever come from the author row or the
 * source itself — a guessed one costs a paid run that returns nothing, which reads as a deleted
 * post. Bounded, oldest dropped first, so a long-running process does not grow it forever.
 */

/** Posts whose handle is kept: several days of tracked short videos. */
const MAX_HANDLES = 20_000;

export interface HandleCache {
  get(source: string, sourceItemId: string): string | null;
  warm(source: string, pairs: Iterable<readonly [sourceItemId: string, handle: string]>): void;
}

export function memoryHandleCache(max = MAX_HANDLES): HandleCache {
  const held = new Map<string, string>();
  return {
    get: (source, id) => held.get(`${source}:${id}`) ?? null,
    warm(source, pairs) {
      for (const [id, handle] of pairs) {
        const key = `${source}:${id}`;
        held.delete(key);
        held.set(key, handle);
      }
      while (held.size > max) {
        const oldest = held.keys().next().value;
        if (oldest === undefined) break;
        held.delete(oldest);
      }
    },
  };
}

/** The runner's one cache. */
export const sourceHandles: HandleCache = memoryHandleCache();
