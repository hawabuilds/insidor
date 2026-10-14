/**
 * THE COIN-LOGO MIRROR, run once: find the coins whose logo is not in our storage yet (the ones on
 * screen first, then a slice of every other coin we hold), copy each one's picture there, record
 * the outcome and, for a coin left as a letter, why; then copy the profile pictures of the posters
 * on the feeds the same way (poster-pics.ts); exit. Scheduled every two minutes by
 * tools/railway-start.mjs beside the board's projector.
 *
 * ★ WHY HERE AND NOT IN THE READ SERVICE. Copying into storage needs the storage service key,
 * and that key can also reach the database through the storage vendor's REST API. The read
 * service holds exactly one credential, the app role, and its whole safety argument rests on
 * that (services/read/src/config.ts); a second, stronger key there would make the argument a
 * claim about code. This process already holds the service credential, so the key adds no new
 * kind of power here.
 *
 * ★ WHY ITS OWN ENTRYPOINT. It makes network calls to a market source and to picture hosts,
 * which the board's one-transaction projector must never wait on; a slow gateway here costs one
 * pass of logos, never a frame of the board.
 *
 * Without SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY it exits cleanly, saying so: the app then
 * shows each coin's own picture, and its letter when there is none, exactly as before.
 */

import { dexscreenerProfiles } from '@insidor/market-dexscreener';
import { coinLogoStore } from '@insidor/storage-supabase/coin-logo.ts';
import { posterPicStore } from '@insidor/storage-supabase/poster-pic.ts';
import { asDb, createPool, DB_ROLE } from '@insidor/store';
import { launchpadPicture, metadataPicture, pictureUrls } from '@insidor/venue-solana-pumpfun';

import { MAX_LOGO_BYTES, mirrorPass } from './coin-logos.ts';
import { MAX_POSTER_BYTES, posterPass } from './poster-pics.ts';

/** One market call is abandoned after this long. */
const FETCH_TIMEOUT_MS = 8_000;
/** One try at one host (a gateway, the launchpad, a picture host) is abandoned after this long, so
 *  a slow gateway hands over to the next instead of holding the pass. */
const TRY_TIMEOUT_MS = 4_000;
/** A metadata document or a coin record is a few kilobytes; one bigger is not read. */
const DOCUMENT_MAX_BYTES = 64 * 1024;

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? '';
  const storageUrl = (process.env['SUPABASE_URL'] ?? '').trim();
  const storageKey = (process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '').trim();
  if (url === '') throw new Error('DATABASE_URL is not set; the logo mirror reads internal.coin_metadata and writes internal.coin_logo.');
  if (storageUrl === '' || storageKey === '') {
    console.log(JSON.stringify({ level: 'info', msg: 'coin logos not mirrored: storage is not configured' }));
    return;
  }
  const pool = createPool(DB_ROLE.service, { applicationName: 'insidor-project-logos', env: { DATABASE_URL_SERVICE: url } });
  const store = coinLogoStore({ url: storageUrl, serviceKey: storageKey, fetch: globalThis.fetch, timeoutMs: TRY_TIMEOUT_MS, maxBytes: MAX_LOGO_BYTES });
  const market = dexscreenerProfiles({ baseUrl: 'https://api.dexscreener.com', fetch: globalThis.fetch, timeoutMs: FETCH_TIMEOUT_MS });
  const documents = { fetch: globalThis.fetch, timeoutMs: TRY_TIMEOUT_MS, maxBytes: DOCUMENT_MAX_BYTES };
  const log = (msg: string, fields: Record<string, unknown>) => console.log(JSON.stringify({ level: 'info', msg, ...fields }));
  await warnIfPrivate(storageUrl, storageKey, log);
  const started = Date.now();
  try {
    const result = await mirrorPass({
      db: asDb(pool),
      nowMs: started,
      elapsedMs: () => Date.now() - started,
      metadataPicture: (uri) => metadataPicture(uri, documents),
      venuePicture: (address) => launchpadPicture(address, documents),
      marketImages: async (addresses) => new Map([...(await market.profiles(addresses))].map(([a, p]) => [a, p.imageUrl])),
      pictureUrls,
      copy: async (address, source) => store.put(address, await store.download(source)),
      log,
    });
    console.log(JSON.stringify({ level: 'info', msg: 'coin logos mirrored', ...result }));
    /* Then the faces of the posters on the feeds (poster-pics.ts), on the time the logos left. */
    const faces = posterPicStore({ url: storageUrl, serviceKey: storageKey, fetch: globalThis.fetch, timeoutMs: TRY_TIMEOUT_MS, maxBytes: MAX_POSTER_BYTES });
    const posterStarted = Date.now();
    const posters = await posterPass({
      db: asDb(pool),
      elapsedMs: () => Date.now() - posterStarted,
      copy: async (file, link) => faces.put(file, await faces.download(link)),
      log,
    });
    console.log(JSON.stringify({ level: 'info', msg: 'poster pictures copied', ...posters }));
  } finally {
    await pool.end();
  }
}

/**
 * The app loads each copy from the bucket's PUBLIC path. A private bucket answers that path with
 * 400 "Bucket not found", so every stored logo would still show as a letter: said loudly, once a
 * pass. Only read here; making the bucket public is a storage setting the owner changes.
 */
async function warnIfPrivate(url: string, key: string, log: (msg: string, fields: Record<string, unknown>) => void): Promise<void> {
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/storage/v1/bucket/launch-metadata`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const body = (await r.json()) as { public?: unknown };
    if (r.ok && body.public !== true) {
      console.error(JSON.stringify({ level: 'error', msg: 'the launch-metadata bucket is private: the app cannot load any stored logo or launch metadata until it is made public' }));
    }
  } catch (e) {
    log('bucket setting not read', { err: e instanceof Error ? e.message : String(e) });
  }
}

main().catch((e: unknown) => {
  console.error(JSON.stringify({ level: 'error', msg: 'coin logo mirror failed', err: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
