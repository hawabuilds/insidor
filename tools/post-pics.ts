/**
 * `node --env-file=.env.local --experimental-strip-types tools/post-pics.ts <status [--sample N] | copy [--yes]>`
 *
 * THE SHOWN POSTS' PICTURES, COPIED INTO OUR STORAGE — the dry run, and the one backfill of every
 * picture already on For You, Popular, the scroll and the narratives whose link still loads (the
 * owner, 2026-10-21: previews must never go blank when a TikTok or X link expires).
 *
 *   status [--sample N]  READ ONLY, in a read-only transaction: how many shown pictures there are,
 *                        how many are copied (after 0119), how many are due now, how many already
 *                        expired, and what one pass and one day would copy under the policy's caps.
 *                        With --sample, N due pictures are downloaded and resized in memory —
 *                        nothing is written anywhere — to measure the bytes a copy takes, and the
 *                        storage a day and a month would need at the last week's volume.
 *   copy [--yes]         the logo job's own pass (services/project/src/post-pics.ts), run until
 *                        nothing is due or the day's cap is reached, so the backfill exists before
 *                        the scheduled passes would make it. Dry run without --yes. Needs migration
 *                        0119 and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Free: picture-host
 *                        downloads and storage writes only.
 *
 * What breaks if changed carelessly: `status` must stay read-only — it is what is run against the
 * live database before the owner says yes — and `copy` must go through postPicPass, so the
 * backfill obeys the same caps, order and records as every later pass.
 */

import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { postPicStore } from '../adapters/storage/supabase/src/post-pic.ts';
import { postPicSizes } from '../services/project/src/post-pic-sizes.ts';
import { COPIED_TODAY_SQL, planPictures, POST_PICS_MIGRATED_SQL, postPicPass, SHOWN_PICTURES_BEFORE_0119_SQL, SHOWN_PICTURES_SQL, type ShownRow } from '../services/project/src/post-pics.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';

const [cmd = 'status', ...rest] = process.argv.slice(2);
const yes = rest.includes('--yes');
const sampleAt = rest.indexOf('--sample');
const sample = sampleAt >= 0 ? Math.max(0, Number(rest[sampleAt + 1] ?? 0) || 0) : 0;
const policy = DEFAULT_POLICY.postPictures;
const pool = createPool(DB_ROLE.service, { env: { DATABASE_URL_SERVICE: process.env['DATABASE_URL'] }, applicationName: 'insidor-post-pics' });

/** Distinct shown pictures by the day they first appeared, over the last full week: the daily volume. */
const DAILY_SQL = `
with ev as (
  select split_part(e ->> 'thumbUrl', '?', 1) as p, to_timestamp(((e -> 'postedAt' ->> 'at')::bigint) / 1000) as at
    from public.story_view v, jsonb_array_elements(case when jsonb_typeof(v.payload -> 'evidence') = 'array' then v.payload -> 'evidence' else '[]'::jsonb end) e
   where e ->> 'thumbUrl' like 'https://%' and e -> 'postedAt' ->> 'at' ~ '^[0-9]+$'
), fp as (
  select split_part(payload ->> 'thumbUrl', '?', 1), first_shown_at from public.feed_post where payload ->> 'thumbUrl' like 'https://%'
), firsts as (select p, min(at) as at from (select * from ev union all select * from fp) x group by p)
select (at at time zone 'utc')::date::text as day, count(*)::int as n from firsts
 where at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc' - interval '7 days'
   and at < date_trunc('day', now() at time zone 'utc') at time zone 'utc'
 group by 1 order by 1`;

const SURFACES = ['For You / Popular', 'scroll', 'narratives'];
const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`;

async function status(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin read only');
    const db = asDb(client);
    const [ready] = await db.query<{ ok: boolean }>(POST_PICS_MIGRATED_SQL, []);
    const migrated = ready?.ok === true;
    const rows = await db.query<ShownRow>(migrated ? SHOWN_PICTURES_SQL : SHOWN_PICTURES_BEFORE_0119_SQL, []);
    const copied = migrated ? ((await db.query<{ n: number }>('select count(*)::int as n from public.post_picture where file is not null', []))[0]?.n ?? 0) : 0;
    const today = migrated ? ((await db.query<{ n: number }>(COPIED_TODAY_SQL, []))[0]?.n ?? 0) : 0;
    const daily = await db.query<{ day: string; n: number }>(DAILY_SQL, []);
    await client.query('rollback');

    const now = Date.now();
    const plan = planPictures(rows, now, policy.retryAfterMs);
    const bySurface = (list: readonly { surface: number }[]) => SURFACES.map((s, i) => `${s} ${list.filter((x) => x.surface === i).length}`).join(', ');
    const expiredSurface = plan.expired.map((e) => ({ surface: Math.min(...rows.filter((r) => r.link === e.link).map((r) => r.surface)) }));
    const tiktok = (list: readonly { link: string }[]) => list.filter((x) => /tiktok/i.test(x.link)).length;
    console.log(`migration 0119: ${migrated ? 'applied' : 'NOT applied (counted as if nothing were copied)'}`);
    console.log(`copied already: ${copied}; copied in the last 24 h: ${today}`);
    console.log(`due now (link still loads): ${plan.due.length} — ${bySurface(plan.due)}; TikTok ${tiktok(plan.due)}`);
    console.log(`already expired, never fetched: ${plan.expired.length} — ${bySurface(expiredSurface)}; TikTok ${tiktok(plan.expired)}`);
    console.log(`refused before, waiting for a new link or the retry: ${plan.waiting}`);
    const room = Math.max(0, policy.perDay - today);
    console.log(`one pass would copy ${Math.min(plan.due.length, policy.perPass, room)}; the next 24 h at most ${Math.min(plan.due.length, room)} (perPass ${policy.perPass}, perDay ${policy.perDay})`);
    const days = daily.filter((d) => d.n > 0);
    const perDay = days.length === 0 ? 0 : days.reduce((a, d) => a + d.n, 0) / days.length;
    console.log(`new shown pictures a day, last ${days.length} full days: ${days.map((d) => `${d.day} ${d.n}`).join(', ')} — mean ${perDay.toFixed(0)}`);

    if (sample > 0) {
      const store = postPicStore({ url: 'https://unused.invalid', serviceKey: '', fetch: globalThis.fetch, timeoutMs: 8_000, maxBytes: policy.maxBytes });
      const step = Math.max(1, Math.floor(plan.due.length / sample));
      const picks = plan.due.filter((_, i) => i % step === 0).slice(0, sample);
      let n = 0;
      let card = 0;
      let sheet = 0;
      let refused = 0;
      for (const p of picks) {
        try {
          const sizes = await postPicSizes((await store.download(p.link)).bytes, policy);
          card += sizes.card.bytes.byteLength;
          sheet += sizes.sheet.bytes.byteLength;
          n += 1;
        } catch {
          refused += 1;
        }
      }
      if (n > 0) {
        const each = (card + sheet) / n;
        const backfill = plan.due.length * each;
        console.log(`sample of ${picks.length} (nothing written): ${n} sized, ${refused} refused; list copy ${kb(card / n)}, sheet copy ${kb(sheet / n)}, ${kb(each)} a picture`);
        console.log(`backfill: ${(backfill / 1024 ** 2).toFixed(0)} MB once; then ${((perDay * each) / 1024 ** 2).toFixed(0)} MB a day, ${((perDay * each * 30) / 1024 ** 3).toFixed(2)} GB a month`);
      }
    }
  } finally {
    client.release();
  }
}

async function copy(): Promise<void> {
  const url = (process.env['SUPABASE_URL'] ?? '').trim();
  const key = (process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '').trim();
  if (url === '' || key === '') throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed to write the copies');
  if (!yes) {
    console.log('dry run: add --yes to copy (status shows what is due)');
    return;
  }
  const db = asDb(pool);
  const store = postPicStore({ url, serviceKey: key, fetch: globalThis.fetch, timeoutMs: 8_000, maxBytes: policy.maxBytes });
  const total = { copied: 0, refused: 0, expired: 0 };
  for (let pass = 0; pass < 500; pass += 1) {
    const started = Date.now();
    const r = await postPicPass({
      db,
      policy,
      nowMs: started,
      elapsedMs: () => Date.now() - started,
      copy: async (file, link) => {
        const { card, sheet } = await postPicSizes((await store.download(link)).bytes, policy);
        await store.put(file, sheet, 'sheet');
        await store.put(file, card, 'card');
      },
      log: (msg, fields) => console.log(msg, JSON.stringify(fields)),
    });
    total.copied += r.copied;
    total.refused += r.refused;
    total.expired += r.expired;
    console.log(`pass ${pass + 1}: ${JSON.stringify(r)}`);
    if (r.copied + r.refused === 0) break;
  }
  console.log(JSON.stringify(total));
}

try {
  if (cmd === 'status') await status();
  else if (cmd === 'copy') await copy();
  else throw new Error(`unknown command '${cmd}': status [--sample N] | copy [--yes]`);
} finally {
  await pool.end();
}
