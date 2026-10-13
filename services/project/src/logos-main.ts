/**
 * THE COIN-LOGO MIRROR, run once: find the coins on screen whose logo is not in our storage yet,
 * copy each one's picture there, record the outcome, exit. Scheduled every two minutes by
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
import { asDb, createPool, DB_ROLE } from '@insidor/store';

import { MAX_LOGO_BYTES, mirrorPass } from './coin-logos.ts';

/** One picture or one market call is abandoned after this long. */
const FETCH_TIMEOUT_MS = 8_000;

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
  const store = coinLogoStore({ url: storageUrl, serviceKey: storageKey, fetch: globalThis.fetch, timeoutMs: FETCH_TIMEOUT_MS, maxBytes: MAX_LOGO_BYTES });
  const market = dexscreenerProfiles({ baseUrl: 'https://api.dexscreener.com', fetch: globalThis.fetch, timeoutMs: FETCH_TIMEOUT_MS });
  try {
    const result = await mirrorPass({
      db: asDb(pool),
      nowMs: Date.now(),
      marketImages: async (addresses) => new Map([...(await market.profiles(addresses))].map(([a, p]) => [a, p.imageUrl])),
      copy: async (address, source) => store.put(address, await store.download(source)),
      log: (msg, fields) => console.log(JSON.stringify({ level: 'info', msg, ...fields })),
    });
    console.log(JSON.stringify({ level: 'info', msg: 'coin logos mirrored', ...result }));
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error(JSON.stringify({ level: 'error', msg: 'coin logo mirror failed', err: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
