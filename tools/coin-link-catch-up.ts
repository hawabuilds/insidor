/**
 * `node --env-file=.env.local --experimental-strip-types tools/coin-link-catch-up.ts [--days <n>]`
 * `SPEND=live node --env-file=.env.local --experimental-strip-types tools/coin-link-catch-up.ts --yes`
 *
 * THE COINS THE COIN-LINK STEP NEVER SAW, LINKED ONCE (the owner, 2026-10-25: "ship it and run the
 * catch-up"). Until 99e4124 the coin-link step took only coins with no metadata row, so a coin the
 * universe loop read first — or whose first read failed and was retried there — got no
 * internal.coin_post_link row: its named post was never read, its promotion never followed to the
 * original, nothing credited. 878 coins naming an X post in the three days to 25 Oct. The fix hands
 * such coins over from now on; this tool hands over the ones already missed: coins first seen in
 * the last `--days` (3) whose stored metadata was read and names a post-shaped link, with no link
 * row.
 *
 * ★ THE RUNNER'S OWN PATH, NOT A COPY. Each batch goes through work/coin-link-hand-off.ts into
 * work/coin-links.ts `coinLinksPass`, exactly as the universe loop's hand-off does: the stored
 * fields, each source's own link parser, the promotion → original follow, and the credit under the
 * same age, approvals and reach rules. Only two things differ, both in the policy copy here: a pass
 * takes `BATCH` handed coins, and may read up to `READS_PER_BATCH` posts (the runner's 10 a pass
 * would leave the rest recorded and unread — never credited — since a catch-up names them once).
 * Its own launches are never read: `freshUnread` answers nothing here.
 *
 * ★ DRY BY DEFAULT, AND DRY WRITES NOTHING. The runner's dry run records links; this one refuses
 * every write statement at the connection and collects the links it would record, prices the post
 * reads and prints them. Live needs SPEND=live and --yes, and spends on the LIVE book under the
 * runner's own supplier lines (tools/lib/shared-meter.ts 'live'), capped at `CAP_USD` in all.
 *
 * What breaks if changed carelessly: the candidate read must keep "no link row". A coin already
 * linked (Nuggets, linked by hand) is then skipped rather than handed again; `recordLinks` would not
 * double a row, but the pass would read and credit its posts a second time.
 */

import process from 'node:process';

import type { Millis } from '../contracts/src/index.ts';
import { DEFAULT_POLICY as P, type Policy } from '../contracts/src/policy.ts';
import type { Meter } from '../contracts/src/ports/meter.ts';
import { inMemoryMeter } from '../adapters/meter/spend/src/index.ts';
import { followLink, resolvePlatforms } from '../adapters/platform/registry/src/registry.ts';
import { asDb, createPool, DB_ROLE, PgAuthorRepo, PgCoinUniverseRepo, PgFinderRepo, PgItemRepo, PgObservationRepo, type CoinPostLink, type Db } from '../store/src/index.ts';
import type { Logger } from '../services/runner/src/log.ts';
import { storeArrivals } from '../services/runner/src/work/arrivals.ts';
import { coinLinkHandOff } from '../services/runner/src/work/coin-link-hand-off.ts';
import { coinLinksPass } from '../services/runner/src/work/coin-links.ts';
import { openSharedMeter } from './lib/shared-meter.ts';

const DAY_MS = 86_400_000;
/* The owner's cap for the whole run, every vendor together. */
const CAP_USD = 0.1;
/* The runner's own page of coins a pass. */
const BATCH = P.finders.coinLinks.perPass;
/* Every post a batch names read in that batch: a catch-up names each once. */
const READS_PER_BATCH = 400;
/* A link a source's parser could take for a post, its own short forms included; the parser decides. */
const POST_SHAPED = String.raw`(x|twitter)\.com/|tiktok\.com/|t\.co/`;
const WRITE = /\b(insert|update|delete|truncate|alter|create|drop)\b/i;

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const days = Number(arg('--days', '3'));
const live = process.env['SPEND'] === 'live' && process.argv.includes('--yes');
if (process.env['SPEND'] === 'live' && !live) {
  console.error('coin-link-catch-up refused: SPEND=live also needs --yes.');
  process.exit(2);
}

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-coin-link-catch-up' });
const raw = asDb(pool);
/* Dry: a write is refused before it reaches the database. */
const db: Db = live ? raw : { query: (sql, params) => (WRITE.test(sql) ? Promise.reject(new Error(`dry run: refused a write: ${sql.slice(0, 60)}`)) : raw.query(sql, params)) };

interface Candidate {
  asset_key: string; address: string; minted_at: Date | null;
  description: string | null; social_link: string | null; website: string | null; chat_link: string | null;
}

async function candidates(sinceMs: number): Promise<readonly Candidate[]> {
  return db.query<Candidate>(
    `select a.asset_key, a.address, a.minted_at, m.description, m.social_link, m.website, m.chat_link
       from public.asset a
       join internal.coin_metadata m using (asset_key)
      where a.origin in ('live_stream', 'backfill')
        and a.first_seen_at >= $1
        and m.outcome = 'read'
        and concat_ws(' ', m.social_link, m.website, m.chat_link, m.description) ~* $2
        and not exists (select 1 from internal.coin_post_link l where l.asset_key = a.asset_key)
      order by a.first_seen_at`,
    [new Date(sinceMs), POST_SHAPED],
  );
}

/** For each recorded link, the earliest OTHER coin naming the same post, as recorded before this run. */
async function earliestOthers(rows: readonly CoinPostLink[], before: number): Promise<Map<string, number | null>> {
  const keys = [...new Set(rows.map((r) => `${r.source}:${r.sourceItemId}`))];
  const out = new Map<string, number | null>(keys.map((k) => [k, null]));
  if (keys.length === 0) return out;
  const found = await db.query<{ k: string; first: Date | null }>(
    `select l.source || ':' || l.source_item_id as k, min(l.minted_at) as first
       from internal.coin_post_link l
      where l.source || ':' || l.source_item_id = any($1::text[]) and l.found_at < $2
      group by 1`,
    [keys, new Date(before)],
  );
  for (const r of found) out.set(r.k, r.first === null ? null : r.first.getTime());
  return out;
}

async function main(): Promise<void> {
  const started = Date.now();
  const list = await candidates(started - days * DAY_MS);
  console.log(`${list.length} coins first seen in the last ${days} days whose stored metadata names a post-shaped link and has no link row (${live ? 'LIVE' : 'dry run'})`);

  let closeMeter: (() => Promise<void>) | null = null;
  let meter: Meter;
  if (live) {
    const shared = await openSharedMeter(CAP_USD, process.env, 'live');
    meter = shared.meter;
    closeMeter = shared.close;
  } else {
    meter = inMemoryMeter({ dailyCapUsd: CAP_USD, softStop: 1, now: Date.now });
  }

  let wouldSpendUsd = 0;
  const warnings: string[] = [];
  const log: Logger = {
    info: (msg, f) => {
      if (msg.startsWith('DRY RUN')) wouldSpendUsd += Number(f?.['wouldSpendUsd'] ?? 0);
    },
    warn: (msg, f) => void warnings.push(`${msg} ${JSON.stringify(f ?? {})}`),
    error: (msg, f) => void warnings.push(`${msg} ${JSON.stringify(f ?? {})}`),
    child: () => log,
  };

  const finders = new PgFinderRepo(db);
  const items = new PgItemRepo(db);
  const recorded: CoinPostLink[] = [];
  let written = 0;
  const handOff = coinLinkHandOff(DAY_MS);
  const policy: Policy = { ...P, finders: { ...P.finders, coinLinks: { ...P.finders.coinLinks, on: true, perPass: BATCH, readsPerPass: READS_PER_BATCH } } };
  const sources = (handles: (source: string, sourceItemId: string) => string | null) =>
    resolvePlatforms(P.budget.shortVideoFirstScraperOff ? { ...process.env, APIFY_TOKEN: '' } : process.env, { meter, now: () => Date.now(), fetch: globalThis.fetch, handles: (source, id) => handles(String(source), id) }).all();
  const totals = { coins: 0, links: 0, postsRead: 0, credited: 0, followed: 0, usd: 0 };

  try {
    for (let i = 0; i < list.length; i += BATCH) {
      const now = Date.now() as Millis;
      for (const c of list.slice(i, i + BATCH)) {
        handOff.give(
          { assetKey: c.asset_key, address: c.address, metadataUri: null, mintedAt: c.minted_at === null ? null : (c.minted_at.getTime() as Millis) },
          { description: c.description, links: { social: c.social_link, website: c.website, chat: c.chat_link } },
          now,
        );
      }
      const r = await coinLinksPass({
        finders: {
          freshUnread: async () => [],
          recordLinks: async (links, at) => {
            recorded.push(...links);
            if (!live) return links.length;
            const n = await finders.recordLinks(links, at);
            written += n;
            return n;
          },
          keepsVia: () => finders.keepsVia(),
          promoFacts: (ids) => finders.promoFacts(ids),
        },
        coins: new PgCoinUniverseRepo(db),
        metadata: { read: async () => Promise.reject(new Error('the catch-up never reads a document')) },
        handOff,
        sources,
        follow: (url) => followLink(url, globalThis.fetch),
        items,
        store: storeArrivals({ authors: new PgAuthorRepo(db), items, observations: new PgObservationRepo(db) }, P, () => Date.now() as Millis),
        meter,
        mode: live ? 'live' : 'dry',
        policy,
        log,
        now: () => Date.now() as Millis,
      });
      totals.coins += r.handed;
      totals.links += r.links;
      totals.postsRead += r.postsRead;
      totals.credited += r.credited;
      totals.followed += r.followed;
      totals.usd += r.usd;
      process.stdout.write(`  batch ${i / BATCH + 1}: ${r.handed} coins, ${r.links} links, ${r.followed} followed, ${r.postsRead} posts read ($${r.usd.toFixed(5)}), ${r.credited} credited\n`);
    }

    /* Which posts now have this run's coin as their earliest — the first coin is the post's. */
    const others = await earliestOthers(recorded, started);
    const firstCoin = new Map<string, CoinPostLink>();
    for (const l of recorded) {
      const k = `${l.source}:${l.sourceItemId}`;
      const had = firstCoin.get(k);
      if (l.mintedAt !== null && (had === undefined || had.mintedAt === null || l.mintedAt < had.mintedAt)) firstCoin.set(k, l);
    }
    const displaced: string[] = [];
    let onlyCoin = 0;
    for (const [k, l] of firstCoin) {
      const other = others.get(k) ?? null;
      if (other === null) onlyCoin += 1;
      else if ((l.mintedAt as number) < other) displaced.push(`${k}  ${l.address}  launched ${new Date(l.mintedAt as number).toISOString()}, ${Math.round((other - (l.mintedAt as number)) / 1000)} s before the coin recorded first`);
    }

    console.log(`\n${totals.coins} coins handed; ${totals.links} links ${live ? `recorded (${written} rows written)` : 'would be recorded'}; ${totals.followed} promotions followed to the original`);
    console.log(live ? `${totals.postsRead} posts read for $${totals.usd.toFixed(5)} (meter: $${meter.spentUsd().toFixed(5)} of $${CAP_USD})` : `posts not held, priced and not read: $${wouldSpendUsd.toFixed(5)} (originals behind unheld promotions are found only when live)`);
    console.log(`${totals.credited} posts ${live ? 'credited' : 'would be credited'} to the coin_link lane (held posts only on a dry run)`);
    console.log(`${firstCoin.size} posts named: ${onlyCoin} had no coin before; ${displaced.length} now have an earlier coin than the one recorded first:`);
    for (const d of displaced) console.log(`  ${d}`);
    if (warnings.length > 0) console.log(`\n${warnings.length} warnings:\n  ${warnings.slice(0, 20).join('\n  ')}`);
  } finally {
    await closeMeter?.();
    await pool.end();
  }
}

await main();
