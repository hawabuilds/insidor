/**
 * `node --env-file=.env.local --experimental-strip-types tools/call-history.ts`
 *
 * THE ONE-OFF BACKFILL OF EVERY CALL'S PRICE HISTORY (the owner, 2026-11-14: "do it and make sure
 * it's accurate"). The runner keeps internal.coin_hour current a few coins a pass
 * (services/runner work/call-history.ts); this reads every call owed a read now, through the same
 * step, so the calls board has the whole history on the day it ships instead of over a day of passes.
 *
 * ★ FREE AND PACED, NEVER THE APP'S MINUTE. Its own GeckoTerminal client on the free public API, from
 * this machine — not the runner's or the read service's instance, so it spends none of their
 * per-minute counts — and one coin every PACE_MS (two requests each: its pool, its hours): ten requests
 * a minute. A first run at 26 a minute (14 November) drew 429s from the vendor and its own limiter
 * held background reads back, so 28 of the first 32 coins failed. A refused read is written as
 * `failed`, and this tool retries failed reads at once (the runner waits RETRY_MS); run it again until
 * the failures stop.
 *
 * What breaks if changed carelessly: the pace. Going over the free limit returns 429s, and every coin
 * read during one is written as a failed read to be done again, not as a coin with no history.
 */

import process from 'node:process';

import { geckoterminal } from '../adapters/market/geckoterminal/src/index.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';

import { readCallHistory } from '../services/runner/src/work/call-history.ts';

/** Every request, not every coin: a coin's two back-to-back requests drew 429s even at ten a minute. */
const PACE_MS = 12_000;
const ALL = Number(process.env['LIMIT'] ?? 5_000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  /* The runner's own role, so the backfill writes exactly as the runner step will. */
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-call-history', max: 2 });
  const db = asDb(pool);
  let last = 0;
  const pacedFetch: typeof globalThis.fetch = async (input, init) => {
    const wait = last + PACE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    return globalThis.fetch(input, init);
  };
  /* Asked as a person's read, not background: this client is this tool's alone, so the share kept
     for people (the adapter's PERSON_SHARE) would only slow it; PACE_MS keeps it under the vendor. */
  const market = geckoterminal({ baseUrl: 'https://api.geckoterminal.com/api/v2', fetch: pacedFetch, timeoutMs: 20_000, now: Date.now });
  const paced = { hourly: (mint: string) => market.hourly(mint) };
  let n = 0;
  const log = {
    info: (msg: string, f?: object) => console.log(msg, JSON.stringify(f ?? {})),
    warn: (msg: string, f?: object) => {
      n += 1;
      if (n <= 20) console.log('warn:', msg, JSON.stringify(f ?? {}));
    },
  };
  const t = Date.now();
  const tally = await readCallHistory({
    db,
    market: paced,
    log,
    now: Date.now,
    perPass: ALL,
    retryMs: 0,
  });
  console.log('done', JSON.stringify(tally), 'in', Math.round((Date.now() - t) / 60_000), 'min');
  await pool.end();
}

await main();
