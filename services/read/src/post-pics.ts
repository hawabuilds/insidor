/**
 * OUR COPY OF EACH POST PICTURE, NAMED ON THE CARD AT READ TIME (0119 public.post_picture): a card
 * (and the post it quotes), a narrative and its posts, and the post sheet's picture carry `thumbFile` / `posterFile` — the
 * 32-hex name of the copy in our storage — beside the source's link, and the app loads
 * `post-pics/<name>` first, because the source's signed link may have expired (on 2026-10-21, 297
 * of the 311 short-video posts on the feeds had a cover that no longer loaded).
 *
 * ★ ADDED HERE, NOT IN THE PROJECTED PAYLOAD, for the poster picture's reason (queries.ts): the
 * copier writes a copy within minutes of a post reaching a feed, and a scroll member's card or a
 * quiet narrative may not be projected again for hours. Read here, the copy is used at the next
 * fetch. One indexed read per reply, for the links already in hand.
 *
 * ★ FOUND BY THE LINK'S PATH. The copier keys a picture by its link without the query string
 * (the signature, new on every read), so whichever signed link a payload carries finds the same
 * copy. No copy is no field: a picture not copied yet, refused, and a database without 0119 all
 * send the payload exactly as projected, and the app uses the link as before. A missing table is
 * never a 500.
 *
 * What breaks if changed carelessly: `linkPath` must cut a link exactly as the copier does
 * (services/project post-pics.ts), or every copy is stored and none is found.
 */

import type { Db } from './queries.ts';

export const PICTURE_FILES_SQL = `
select link_path, file from public.post_picture
 where link_path = any($1::text[]) and file is not null`;

const FILE = /^[0-9a-f]{32}$/;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The link without its signature: the copier's key. Kept equal to services/project post-pics.ts. */
export function linkPath(link: string): string {
  return link.split(/[?#]/, 1)[0] ?? link;
}

/** Each link's copy, by path; empty before 0119. */
export async function pictureFiles(db: Db, links: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const paths = [...new Set(links.filter((l) => l.startsWith('https://')).map(linkPath))];
  if (paths.length === 0) return new Map();
  let rows: readonly Record<string, unknown>[];
  try {
    rows = await db.query(PICTURE_FILES_SQL, [paths]);
  } catch (e) {
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '42P01') return new Map();
    throw e;
  }
  const out = new Map<string, string>();
  for (const r of rows) if (typeof r['link_path'] === 'string' && typeof r['file'] === 'string' && FILE.test(r['file'])) out.set(r['link_path'], r['file']);
  return out;
}

/** The copy of a link, or undefined. */
export function fileOf(files: ReadonlyMap<string, string>, link: unknown): string | undefined {
  return typeof link === 'string' ? files.get(linkPath(link)) : undefined;
}

/** The picture links a payload carries: its own, its quoted post's, and its evidence's (a narrative's posts). */
export function pictureLinks(p: unknown): string[] {
  if (!isObj(p)) return [];
  const out: string[] = [];
  if (typeof p['thumbUrl'] === 'string') out.push(p['thumbUrl']);
  if (isObj(p['quote']) && typeof p['quote']['thumbUrl'] === 'string') out.push(p['quote']['thumbUrl']);
  if (Array.isArray(p['evidence'])) for (const e of p['evidence']) if (isObj(e) && typeof e['thumbUrl'] === 'string') out.push(e['thumbUrl']);
  return out;
}

/** One payload with `thumbFile` beside every picture that has a copy; the same object when none has. */
export function withFile<T>(p: T, files: ReadonlyMap<string, string>): T {
  if (!isObj(p) || files.size === 0) return p;
  const own = fileOf(files, p['thumbUrl']);
  const q = p['quote'];
  const quoteFile = isObj(q) ? fileOf(files, q['thumbUrl']) : undefined;
  let evidence: unknown = p['evidence'];
  let changed = own !== undefined || quoteFile !== undefined;
  if (Array.isArray(evidence)) {
    const list = evidence.map((e) => {
      const f = isObj(e) ? fileOf(files, e['thumbUrl']) : undefined;
      return f === undefined ? e : { ...(e as Json), thumbFile: f };
    });
    if (list.some((e, i) => e !== (evidence as unknown[])[i])) {
      evidence = list;
      changed = true;
    }
  }
  if (!changed) return p;
  return {
    ...p,
    ...(own !== undefined ? { thumbFile: own } : {}),
    ...(quoteFile !== undefined && isObj(q) ? { quote: { ...q, thumbFile: quoteFile } } : {}),
    ...(Array.isArray(evidence) ? { evidence } : {}),
  } as T;
}

/** Cards, narratives or narrative pages, each with its pictures' copies named. One read for all. */
export async function withPictureFiles<T>(db: Db, payloads: readonly T[]): Promise<readonly T[]> {
  const files = await pictureFiles(db, payloads.flatMap(pictureLinks));
  return files.size === 0 ? payloads : payloads.map((p) => withFile(p, files));
}
