/**
 * WHAT A STREAM HAS ALREADY ALERTED ON (people.pipeline_seen), HELD IN THIS PROCESS AND CAUGHT UP.
 *
 * ★ WHY. Every alert pass (launch, blowing up, first coin, pipeline, big accounts, creator buyers,
 * curve opens) asked for its stream's whole seen set every 20 seconds: ~1,000 keys a read, ~47M
 * rows and ~1.8 GB a day of the database's egress on 29 Oct 2026, nearly all of them the keys the
 * pass before was sent. A stream is now read whole once per process and then only for the keys
 * whose `seen_at` is at or after the newest held, less `OVERLAP_MS`.
 *
 * ★ WHY THAT IS THE SAME ANSWER. Nothing deletes from people.pipeline_seen and a key's `seen_at`
 * is set once, by the database (`default now()`, the inserting transaction's start), so the keys
 * stamped since the last read are exactly the new ones; the overlap covers a transaction that began
 * just before that read and committed after it. Every writer is a single statement in this service.
 *
 * Held per `Db` (a WeakMap), so a test's fake database never shares a set with another. The set
 * returned is the caller's own copy: the passes delete their `#seeded` marker from it.
 *
 * What breaks if changed carelessly: a prune of people.pipeline_seen, or a writer that sets
 * `seen_at` itself to an older instant, would leave a deleted key held here or a new one unseen —
 * a pass would then re-send or never send an alert. Either needs a whole re-read instead.
 */

import type { Db } from './deliver.ts';

const OVERLAP_MS = 2 * 60_000;

interface Held {
  readonly keys: Set<string>;
  /** The newest `seen_at` read, epoch ms; null before the first read. */
  newestMs: number | null;
}

const HELD = new WeakMap<Db, Map<string, Held>>();

/** Every key of `stream` in people.pipeline_seen, as of now. */
export async function seenKeys(db: Db, stream: string): Promise<Set<string>> {
  const streams = HELD.get(db) ?? new Map<string, Held>();
  HELD.set(db, streams);
  const held = streams.get(stream) ?? { keys: new Set<string>(), newestMs: null };
  const rows = await db.query<{ key: string; at: number | string }>(
    `select key, extract(epoch from seen_at)::float8 * 1000 as at from people.pipeline_seen
      where stream = $1 and ($2::float8 is null or seen_at >= to_timestamp($2::float8 / 1000))`,
    [stream, held.newestMs === null ? null : held.newestMs - OVERLAP_MS],
  );
  for (const r of rows) {
    held.keys.add(r.key);
    const at = Number(r.at);
    if (held.newestMs === null || at > held.newestMs) held.newestMs = at;
  }
  /* Held only once read: a failed first read throws above and the next pass reads whole again. */
  streams.set(stream, held);
  return new Set(held.keys);
}
