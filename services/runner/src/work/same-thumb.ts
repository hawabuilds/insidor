/**
 * ONE GIF UPLOADED TWICE IS ONE VIDEO: two GIF uploads whose thumbnails hash alike are given one
 * video key, so the narratives' same-video link (Policy.narrative.sameVideo) holds across them.
 *
 * Why (the owner, 2026-11-11, the boxing cat): the same cat GIF reached X as two uploads, 23 posts
 * on one and 5 on the other, and an upload's key only joins posts of that one upload. Their
 * thumbnails were byte for byte the same picture. Over three days of For You, every pair of
 * different GIF uploads whose thumbnails hashed alike was the same GIF re-uploaded (the boxing cat,
 * a dancing kitten, a squirrel) — never two different GIFs.
 *
 * Its own file because the one judgement in it is easy to get wrong: A FLAT PICTURE MATCHES EVERY
 * OTHER FLAT PICTURE. A GIF that opens on a black or white frame hashes to nearly all zeros or all
 * ones, whatever the GIF is, so a hash with fewer than `MIN_SET_BITS` or more than `64 −
 * MIN_SET_BITS` bits set is never matched. The hash itself is the runner's (picture-hash.ts),
 * stored by the picture-hash step; a thumbnail not hashed yet keeps its own key, as before.
 *
 * What breaks if changed carelessly: joining a hash to a key that is not a GIF's. A video's
 * thumbnail is one frame the platform picked, and two different videos of one scene can share it.
 */

import { hashDistance } from './picture-hash.ts';

/** A hash with fewer bits set than this, or as few left unset, is a near-flat picture: never matched. */
const MIN_SET_BITS = 8;
const HASH_BITS = 64;

const setBits = (hex: string): number => [...BigInt(`0x${hex}`).toString(2)].filter((c) => c === '1').length;

/** The first looping video's thumbnail in a post's stored media: a GIF's; null when it has none. */
export function gifThumbOf(media: unknown): string | null {
  if (!Array.isArray(media)) return null;
  for (const m of media) {
    if (m === null || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    if (r['kind'] === 'video' && r['loops'] === true && typeof r['uri'] === 'string' && /^https:\/\//i.test(r['uri'])) return r['uri'];
  }
  return null;
}

/**
 * Each post's video key, with the keys of GIF uploads whose thumbnails are within `maxBits` of each
 * other made one (the smallest of them, so the answer does not depend on the order posts come in).
 * `keys` is post → its own key; `thumbs` post → its GIF thumbnail; `hashes` thumbnail → its hash.
 */
export function sameThumbKeys(
  keys: ReadonlyMap<string, string>,
  thumbs: ReadonlyMap<string, string>,
  hashes: ReadonlyMap<string, string>,
  maxBits: number,
): ReadonlyMap<string, string> {
  /* One hash per GIF key: its posts share one upload, so one thumbnail. */
  const hashOfKey = new Map<string, string>();
  for (const [item, key] of keys) {
    const thumb = thumbs.get(item);
    const hash = thumb === undefined ? undefined : hashes.get(thumb);
    if (hash === undefined || hashOfKey.has(key)) continue;
    const set = setBits(hash);
    if (set < MIN_SET_BITS || set > HASH_BITS - MIN_SET_BITS) continue;
    hashOfKey.set(key, hash);
  }
  const parent = new Map<string, string>([...hashOfKey.keys()].map((k) => [k, k]));
  const root = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r) ?? r;
    return r;
  };
  const listed = [...hashOfKey].sort(([a], [b]) => a.localeCompare(b));
  for (let i = 0; i < listed.length; i += 1) {
    for (let j = i + 1; j < listed.length; j += 1) {
      const [ka, ha] = listed[i]!;
      const [kb, hb] = listed[j]!;
      if (hashDistance(ha, hb) > maxBits) continue;
      const [ra, rb] = [root(ka), root(kb)];
      if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
    }
  }
  return new Map([...keys].map(([item, key]) => [item, parent.has(key) ? root(key) : key]));
}
