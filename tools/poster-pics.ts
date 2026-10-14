/**
 * `node --env-file=.env.local --experimental-strip-types tools/poster-pics.ts <status | jpeg | copy> [--yes]`
 *
 * THE POSTER PICTURES, BACKFILLED FOR EVERY POSTER ALREADY ON FOR YOU, POPULAR AND THE SCROLL (the
 * owner, 2026-10-14: "i want to see tiktok poster pfp in fyp aswell").
 *
 *   status        how many feed posters per source have a picture link, an HEIC link, an expired
 *                 link, and (after 0079) our own copy. Free; reads only.
 *   jpeg [--yes]  for each TikTok feed poster whose stored link is HEIC (saved before the search
 *                 reader chose the JPEG, adapters/platform/tiktok/src/search-actor.ts), finds the
 *                 JPEG link of the same picture in the scraper's datasets of the last two days —
 *                 runs already paid for, read back at no actor charge — and stores it. Dry run
 *                 without --yes. Nothing is re-scraped: a poster absent from those datasets keeps
 *                 its HEIC link, which Safari still draws, until the source returns it again.
 *   copy [--yes]  the logo job's own poster pass (services/project/src/poster-pics.ts), run until
 *                 nothing is due, so the copies exist before the next scheduled passes would make
 *                 them. Needs migration 0079 and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Free:
 *                 picture-host downloads and storage writes only.
 *
 * Order: jpeg first (an HEIC link cannot be copied: the sniff refuses it), then copy.
 *
 * What breaks if changed carelessly: `jpeg` must read the datasets through the adapter's own
 * reader (fromSearchActor + toAuthor), so the link it stores is the one a new read would store;
 * and it replaces a link only with one for the SAME account and the same picture path, never a
 * different face.
 */

import process from 'node:process';

import { fromSearchActor } from '../adapters/platform/tiktok/src/search-actor.ts';
import { toAuthor } from '../adapters/platform/tiktok/src/to-item.ts';
import { posterPicStore } from '../adapters/storage/supabase/src/poster-pic.ts';
import { MAX_POSTER_BYTES, posterPass } from '../services/project/src/poster-pics.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';

const [cmd = 'status', ...rest] = process.argv.slice(2);
const yes = rest.includes('--yes');
const pool = createPool(DB_ROLE.service, { env: { DATABASE_URL_SERVICE: process.env['DATABASE_URL'] }, applicationName: 'insidor-poster-pics' });
const db = asDb(pool);

const FEED_POSTERS = `
with shown as (
  select item_id from public.rising_row
  union
  select item_id from public.feed_post where withdrawn_at is null
)
select distinct a.* from shown s
  join public.item i on i.item_id = s.item_id
  join public.author a on a.author_key = i.author_key`;

/** The path of a link, without the signature: the same picture under any signature. */
const pathOf = (u: string) => (u.split(/[?#]/, 1)[0] ?? u).replace(/^https:\/\/[^/]+/, '');
const isHeic = (u: string) => /\.heic$/i.test(u.split(/[?#]/, 1)[0] ?? '');

async function status(): Promise<void> {
  const rows = await db.query<Record<string, unknown>>(`
    select a.source, count(*)::int as posters, count(a.picture_url)::int as with_link,
           count(*) filter (where a.picture_url ~* '\\.heic(\\?|$)')::int as heic,
           count(*) filter (where substring(a.picture_url from 'x-expires=(\\d+)')::bigint < extract(epoch from now()))::int as expired,
           count(*) filter (where to_jsonb(a) ->> 'picture_copy' is not null)::int as copied
      from (${FEED_POSTERS}) a group by 1 order by 1`);
  console.table(rows);
}

async function jpeg(): Promise<void> {
  const token = process.env['APIFY_TOKEN'] ?? '';
  if (token === '') throw new Error('APIFY_TOKEN is not set: the datasets cannot be read');
  const heic = (await db.query<{ author_key: string; handle: string | null; picture_url: string }>(`select author_key, handle, picture_url from (${FEED_POSTERS}) a where a.source = 'tiktok' and a.picture_url ~* '\\.heic(\\?|$)'`));
  console.log(`${heic.length} TikTok feed posters have an HEIC link`);
  if (heic.length === 0) return;
  const want = new Map(heic.map((h) => [h.author_key, h]));
  const found = new Map<string, string>();
  const headers = { authorization: `Bearer ${token}` };
  const since = Date.now() - 2 * 86_400_000;
  let runsRead = 0;
  let entries = 0;
  for (let offset = 0; offset < 2_000 && found.size < want.size; offset += 100) {
    const page = (await (await fetch(`https://api.apify.com/v2/actor-runs?desc=1&limit=100&offset=${offset}`, { headers })).json()) as { data: { items: { status: string; startedAt: string; defaultDatasetId: string }[] } };
    const runs = page.data.items;
    if (runs.length === 0) break;
    for (const run of runs) {
      if (Date.parse(run.startedAt) < since) {
        offset = Infinity;
        break;
      }
      if (run.status !== 'SUCCEEDED') continue;
      const items = (await (await fetch(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?clean=1&limit=1000`, { headers })).json()) as unknown[];
      runsRead += 1;
      for (const raw of Array.isArray(items) ? items : []) {
        entries += 1;
        let author;
        try {
          author = toAuthor(fromSearchActor(raw), 0 as never);
        } catch {
          continue;
        }
        const link = author?.pictureUri ?? null;
        if (author === null || author === undefined || link === null || link === undefined || isHeic(link) || found.has(author.authorKey)) continue;
        const had = want.get(author.authorKey);
        /* The same picture only: the stored HEIC's path with its extension swapped. */
        if (had !== undefined && pathOf(had.picture_url).replace(/\.heic$/i, '') === pathOf(link).replace(/\.(jpe?g|webp|png)$/i, '')) found.set(author.authorKey, link);
      }
    }
  }
  console.log(`read ${runsRead} datasets (${entries} entries) from the last two days; a JPEG link for ${found.size} of ${heic.length}`);
  for (const h of heic) console.log(`  ${found.has(h.author_key) ? 'jpeg ' : 'none '} @${h.handle ?? '?'}`);
  if (!yes) {
    console.log('dry run: add --yes to store them');
    return;
  }
  for (const [key, link] of found) await db.query('update public.author set picture_url = $2 where author_key = $1', [key, link]);
  console.log(`stored ${found.size} JPEG links`);
}

async function copy(): Promise<void> {
  const url = (process.env['SUPABASE_URL'] ?? '').trim();
  const key = (process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '').trim();
  if (url === '' || key === '') throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed to write the copies');
  if (!yes) {
    console.log('dry run: add --yes to copy (status shows what is due)');
    return;
  }
  const store = posterPicStore({ url, serviceKey: key, fetch: globalThis.fetch, timeoutMs: 6_000, maxBytes: MAX_POSTER_BYTES });
  const total = { copied: 0, same: 0, refused: 0 };
  for (let pass = 0; pass < 20; pass += 1) {
    const started = Date.now();
    const r = await posterPass({
      db,
      elapsedMs: () => Date.now() - started,
      copy: async (file, link) => store.put(file, await store.download(link)),
      log: (msg, fields) => console.log(msg, JSON.stringify(fields)),
    });
    total.copied += r.copied;
    total.same += r.same;
    total.refused += r.refused;
    if (r.copied + r.same + r.refused === 0) break;
  }
  console.log(JSON.stringify(total));
}

try {
  if (cmd === 'status') await status();
  else if (cmd === 'jpeg') await jpeg();
  else if (cmd === 'copy') await copy();
  else throw new Error(`unknown command '${cmd}': status | jpeg | copy`);
} finally {
  await pool.end();
}
