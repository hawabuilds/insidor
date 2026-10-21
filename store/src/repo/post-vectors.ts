/**
 * The runner's own post vectors (0074 internal.post_embedding) as the readers that only need the
 * numbers ask for them: held in the process by post, space and `embedded_at`, and read from the
 * table only when not held at that instant.
 *
 * Its own file because two repositories read the same vectors for different questions — the junk
 * filter (junk-filter.ts `vectors`) and the narrative matcher (narratives.ts `vectors`) — and each
 * used to pull every vector it was asked about as ~12 KB of text on every pass, a few hundred
 * thousand times in nine days. The cache is shared by every repo in the process, because the same
 * post is asked about by both.
 *
 * ★ `embedded_at` IS THE VERSION. 0074's upsert stamps it with `now()` whenever a vector is
 * written or replaced, so a held vector is served only while the table's row is the one it was read
 * from. The version read costs a post id and a timestamp per post; the vector crosses the wire once.
 *
 * What breaks if changed carelessly: keying by post alone (a re-embedded post would keep its old
 * vector for the life of the process), or dropping the cap (the cache would grow with every post
 * the runner ever matched, ~4 KB each).
 */

import type { Db } from '../client.ts';

/** At most this many vectors are held; the oldest read goes first. ~4 KB each in 1024 dimensions. */
const HELD_POST_VECTORS_MAX = 8_000;

const held = new Map<string, { readonly at: string; readonly values: Float32Array }>();

/** pgvector's text form, `[0.1,0.2,…]`, as numbers. */
const parseVector = (v: unknown): Float32Array => {
  if (Array.isArray(v)) return Float32Array.from(v as number[]);
  const s = String(v ?? '').replace(/^\[|\]$/g, '');
  return s === '' ? new Float32Array() : Float32Array.from(s.split(',').map(Number));
};

/**
 * These posts' vectors in `space`, from what is held or read now. Posts with no row are absent.
 * Throws what the table read throws (a caller that tolerates a missing 0074 catches it).
 */
export async function heldPostVectors(db: Db, itemIds: readonly string[], space: string): Promise<ReadonlyMap<string, Float32Array>> {
  const out = new Map<string, Float32Array>();
  if (itemIds.length === 0) return out;
  const key = (id: string): string => `${space}\u0000${id}`;
  const versions = await db.query<{ item_id: string; at: string }>(
    'select item_id, embedded_at::text as at from internal.post_embedding where item_id = any($1::text[]) and space = $2',
    [[...new Set(itemIds)], space],
  );
  const missing = versions.filter((r) => held.get(key(r.item_id))?.at !== r.at).map((r) => r.item_id);
  if (missing.length > 0) {
    const rows = await db.query<{ item_id: string; v: unknown; at: string }>(
      'select item_id, embedding::text as v, embedded_at::text as at from internal.post_embedding where item_id = any($1::text[]) and space = $2',
      [missing, space],
    );
    for (const r of rows) {
      held.delete(key(r.item_id));
      held.set(key(r.item_id), { at: r.at, values: parseVector(r.v) });
    }
    while (held.size > HELD_POST_VECTORS_MAX) {
      const oldest = held.keys().next().value;
      if (oldest === undefined) break;
      held.delete(oldest);
    }
  }
  for (const r of versions) {
    const v = held.get(key(r.item_id));
    /* Dropped by the cap in this same call (more posts asked than it holds): read it whole now. */
    if (v === undefined) continue;
    out.set(r.item_id, v.values);
  }
  const lost = versions.filter((r) => !out.has(r.item_id)).map((r) => r.item_id);
  if (lost.length > 0) {
    const rows = await db.query<{ item_id: string; v: unknown }>(
      'select item_id, embedding::text as v from internal.post_embedding where item_id = any($1::text[]) and space = $2',
      [lost, space],
    );
    for (const r of rows) out.set(r.item_id, parseVector(r.v));
  }
  return out;
}

/** Empties the cache: for tests, which share the process. */
export function forgetHeldPostVectors(): void {
  held.clear();
}
