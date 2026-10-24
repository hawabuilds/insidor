/**
 * THE QUOTED POST'S ACCOUNT FACE, PUT ON THE CARD AT READ TIME: a card whose post quotes another
 * carries `quote` (services/project rising.ts), and this adds the quoted account's profile picture
 * to it — `authorPictureUrl` and `authorPictureFile`, the same two fields the card's own poster has
 * (the owner's rule: every @handle shown has its picture beside it).
 *
 * ★ ADDED HERE, NOT IN THE PROJECTED PAYLOAD, for the poster picture's reason (queries.ts): the
 * copier writes a face copy within minutes, and a scroll member's card may not be projected again
 * for hours. Read here, the copy is used at the next fetch.
 *
 * ★ WHERE THE FACE COMES FROM. The account row (public.author) for the quoted post's account when
 * we hold one — its link and our copy (0079) — else the link the quote's own payload carried
 * (0128 public.reproduced_post). The account is found through the quoted post: its public.item row
 * when a search found it too, else the 0128 row. No face is no field: the app draws the letter.
 * A database without 0128 reads the post rows alone; a missing table is never a 500.
 *
 * What breaks if changed carelessly: `picture_url` and `picture_copy` are read through
 * `to_jsonb(a)`, as every other face read is, so this reads the same before 0067 and 0079.
 */

import type { Db } from './queries.ts';

export const QUOTE_FACES_SQL = `
select x.id, coalesce(to_jsonb(a) ->> 'picture_url', rp.author_picture_url) as picture_url, to_jsonb(a) ->> 'picture_copy' as picture_copy
  from unnest($1::text[]) as x(id)
  left join public.item i on i.item_id = x.id
  left join public.reproduced_post rp on rp.item_id = x.id
  left join public.author a on a.author_key = coalesce(i.author_key, rp.author_key)`;

/** Before 0128: the quoted post's account through its post row alone. */
export const QUOTE_FACES_ITEMS_SQL = `
select i.item_id as id, to_jsonb(a) ->> 'picture_url' as picture_url, to_jsonb(a) ->> 'picture_copy' as picture_copy
  from public.item i
  join public.author a on a.author_key = i.author_key
 where i.item_id = any($1::text[])`;

const FILE = /^[0-9a-f]{32}$/;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface Face {
  readonly url: string | null;
  readonly file: string | null;
}

/** The quoted post's id a payload carries, or null. */
function quoteId(p: unknown): string | null {
  if (!isObj(p) || !isObj(p['quote'])) return null;
  const id = p['quote']['id'];
  return typeof id === 'string' && id !== '' ? id : null;
}

async function faces(db: Db, ids: readonly string[]): Promise<ReadonlyMap<string, Face>> {
  if (ids.length === 0) return new Map();
  let rows: readonly Record<string, unknown>[];
  try {
    rows = await db.query(QUOTE_FACES_SQL, [ids]);
  } catch (e) {
    if (typeof e !== 'object' || e === null || (e as { code?: unknown }).code !== '42P01') throw e;
    rows = await db.query(QUOTE_FACES_ITEMS_SQL, [ids]);
  }
  const out = new Map<string, Face>();
  for (const r of rows) {
    if (typeof r['id'] !== 'string') continue;
    const url = typeof r['picture_url'] === 'string' && r['picture_url'].startsWith('https://') ? r['picture_url'] : null;
    const file = typeof r['picture_copy'] === 'string' && FILE.test(r['picture_copy']) ? r['picture_copy'] : null;
    if (url !== null || file !== null) out.set(r['id'], { url, file });
  }
  return out;
}

/** The faces of the accounts these cards quote, by quoted post id. One read for all; none when no card quotes. */
export async function quoteFaces(db: Db, payloads: readonly unknown[]): Promise<ReadonlyMap<string, Face>> {
  return faces(db, [...new Set(payloads.flatMap((p) => quoteId(p) ?? []))]);
}

/** One card with its quoted account's face added; a card with no quote, or no face held, is the same object. */
export function withQuoteFace<T>(p: T, found: ReadonlyMap<string, Face>): T {
  const id = quoteId(p);
  const face = id === null ? undefined : found.get(id);
  if (face === undefined || !isObj(p)) return p;
  return { ...p, quote: { ...(p['quote'] as Json), authorPictureUrl: face.url, authorPictureFile: face.file } } as T;
}

/** Cards with their quoted accounts' faces added. */
export async function withQuoteFaces<T>(db: Db, payloads: readonly T[]): Promise<readonly T[]> {
  const found = await quoteFaces(db, payloads);
  return found.size === 0 ? payloads : payloads.map((p) => withQuoteFace(p, found));
}
