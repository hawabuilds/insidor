/**
 * THE HISTORY PILOT, STAGE BY STAGE: coins still alive today, grouped into narratives, priced
 * before anything is spent.
 *
 *   node --env-file=.env.local tools/history-pilot.ts counts     Dune stage 0 (needs DUNE_API_KEY; a few credits)
 *   node --env-file=.env.local tools/history-pilot.ts alive      today's alive coins (free; Dune if the key is set)
 *   node --env-file=.env.local tools/history-pilot.ts estimate   group them and price the pilot (free)
 *
 * The paid stage — each narrative's origin, found once, stored with its timeline — is not here
 * yet. It is built after the founders have seen this estimate, and it will refuse to start
 * without SPEND=live and --yes, and stop at `universe.history.pilotUsd` in total.
 *
 * WHY "ALIVE" HAS TWO SOURCES. Dune's one-day query (tools/dune/4_alive.sql) lists every launchpad
 * coin that traded today above the bar: the census. Without a Dune key, GeckoTerminal's pool
 * listing (ten pages of each launchpad venue, by volume) is free and gives a LOWER BOUND — every
 * coin it lists is real, but a quiet coin with a high market cap may not be on its ten pages.
 * The tool says which source it used, and never presents a lower bound as a count.
 *
 * Either way, each candidate's market cap is then read NOW from DexScreener's batch lookup, and
 * only coins at or above `universe.history.aliveMarketCapUsd` are kept. Output goes to
 * var/history/ (not committed).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import type { CoinSearchHit } from '../contracts/src/ports/coin-search.ts';
import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { biggestFirst, groupCoins, type HistoryCoin } from '../core/src/history/group.ts';
import { duneClient, fillParameters } from '../adapters/history/dune/src/index.ts';
import { dexscreenerStandings } from '../adapters/market/dexscreener/src/index.ts';
import { geckoterminal, LISTING_PAGES } from '../adapters/market/geckoterminal/src/index.ts';

const P = DEFAULT_POLICY;
const H = P.universe.history;
const OUT = new URL('../var/history/', import.meta.url);
const ALIVE_FILE = new URL('alive.json', OUT);

/* Prices, as the other paid tools state them (tools/gold-fetch.ts). */
const X_USD_PER_POST = 0.000_15;
const VOYAGE_USD_PER_IMAGE = (1_800 * 0.12) / 1e6;
const JUDGE_USD_PER_POST = 0.000_7;
/* One X search back per narrative: one page of results from just before its first coin. */
const SEARCH_RESULTS = 20;
/* Of those, about this many carry a picture worth embedding, and this many survive the name
   and picture checks to reach the judge (the 2026-10-12 gold-set run). */
const PICTURES_PER_SEARCH = 8;
const JUDGED_PER_SEARCH = 3;
/* About a quarter of coins link a post in their metadata; reading it by id is one post. */
const CREATOR_POST_SHARE = 0.25;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const usd = (n: number) => `$${n.toFixed(2)}`;

function dune() {
  const apiKey = process.env['DUNE_API_KEY'];
  if (apiKey === undefined || apiKey === '') return null;
  return duneClient({ apiKey, baseUrl: 'https://api.dune.com', fetch: globalThis.fetch, timeoutMs: 600_000, pollMs: 5_000, sleep });
}

function query(file: string, values: Record<string, string | number> = {}): string {
  return fillParameters(readFileSync(new URL(`dune/${file}`, import.meta.url), 'utf8'), values);
}

async function counts(): Promise<void> {
  const d = dune();
  if (d === null) {
    console.log('DUNE_API_KEY is not set. Add it to .env.local and run this again; nothing was run.');
    return;
  }
  const run = await d.run(query('0_counts.sql'));
  console.log('stage 0 counts:', run.rows[0] ?? '(no row)');
  console.log('credits charged:', run.credits ?? 'not reported');
}

interface AliveCoin {
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly bonded: boolean;
  readonly marketCapUsd: number;
  readonly launchedAt: number | null;
}

/* When each candidate launched, when the source said: Dune's create calls. */
const launched = new Map<string, number>();

async function candidates(): Promise<{ readonly source: string; readonly census: boolean; readonly hits: ReadonlyMap<string, number | null> }> {
  const d = dune();
  if (d !== null) {
    const run = await d.run(query('4_alive.sql', { since_hours: 24, mcap_bar_usd: H.aliveMarketCapUsd }));
    console.log('dune credits charged:', run.credits ?? 'not reported');
    const hits = new Map<string, number | null>();
    for (const r of run.rows) {
      if (typeof r['mint'] !== 'string') continue;
      hits.set(r['mint'], null);
      const at = typeof r['launched_at'] === 'string' ? Date.parse(r['launched_at'].replace(' UTC', 'Z').replace(' ', 'T')) : Number.NaN;
      if (Number.isFinite(at)) launched.set(r['mint'], at);
    }
    return { source: 'dune: every launchpad coin traded in the last day above the bar', census: true, hits };
  }
  const g = geckoterminal({ plan: 'free', baseUrl: 'https://api.geckoterminal.com/api/v2', fetch: globalThis.fetch, timeoutMs: 15_000, now: Date.now });
  const hits = new Map<string, number | null>();
  for (const venue of ['pool', 'curve'] as const) {
    for (let page = 1; page <= LISTING_PAGES; page += 1) {
      let rows: readonly CoinSearchHit[];
      try {
        rows = await g.launchpadPools(venue, page);
      } catch (e) {
        console.log(`  ${venue} page ${page}: ${e instanceof Error ? e.message : String(e)}; waiting a minute`);
        await sleep(61_000);
        page -= 1;
        continue;
      }
      for (const h of rows) {
        hits.set(h.address, h.marketCapUsd);
      }
      await sleep(2_500);
    }
  }
  return { source: 'geckoterminal: ten pages of each launchpad venue by 24h volume — a lower bound', census: false, hits };
}

async function alive(): Promise<void> {
  const { source, census, hits } = await candidates();
  console.log(`candidates: ${hits.size} (${source})`);
  const standings = dexscreenerStandings({ baseUrl: 'https://api.dexscreener.com', fetch: globalThis.fetch, timeoutMs: 15_000 });
  const addresses = [...hits.keys()];
  const kept: AliveCoin[] = [];
  let unlisted = 0;
  for (let i = 0; i < addresses.length; i += standings.batch) {
    const batch = addresses.slice(i, i + standings.batch);
    const answer = await standings.standings(batch);
    for (const a of batch) {
      const s = answer.get(a);
      if (s === undefined) {
        unlisted += 1;
        continue;
      }
      if (s.marketCapUsd !== null && s.marketCapUsd >= H.aliveMarketCapUsd) {
        kept.push({ address: a, name: s.name ?? null, ticker: s.ticker ?? null, bonded: s.bonded, marketCapUsd: s.marketCapUsd, launchedAt: launched.get(a) ?? null });
      }
    }
    await sleep(250);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(ALIVE_FILE, `${JSON.stringify({ source, census, at: new Date().toISOString(), coins: kept }, null, 1)}\n`);
  const bonded = kept.filter((c) => c.bonded).length;
  console.log(`alive at or above ${usd(H.aliveMarketCapUsd)} now: ${kept.length} (${bonded} bonded, ${kept.length - bonded} on the curve); ${unlisted} candidates not listed`);
  console.log(census ? 'This is the census.' : 'This is a LOWER BOUND: coins quiet today but above the bar are not on the listing.');
  console.log('Top 20 by market cap now:');
  for (const c of [...kept].sort((x, y) => y.marketCapUsd - x.marketCapUsd).slice(0, 20)) {
    const day = c.launchedAt === null ? '—' : new Date(c.launchedAt).toISOString().slice(0, 10);
    console.log(`  ${(c.ticker ?? '—').padEnd(12)} ${(c.name ?? '—').slice(0, 28).padEnd(28)} ${usd(c.marketCapUsd).padStart(18)}  ${day}  ${c.bonded ? 'bonded' : 'curve'}`);
  }
}

function estimate(): void {
  const file = JSON.parse(readFileSync(ALIVE_FILE, 'utf8')) as { source: string; census: boolean; coins: AliveCoin[] };
  const coins: HistoryCoin[] = file.coins.map((c) => ({ address: c.address, name: c.name, ticker: c.ticker, launchedAt: c.launchedAt, marketCapUsd: c.marketCapUsd, linkedPost: null }));
  /* Free evidence only (name with ticker): picture pairs and creator links are read by the paid
     stage, and can only JOIN narratives — so this count is an upper bound on narratives. */
  const narratives = biggestFirst(groupCoins(coins, [], P));
  const multi = narratives.filter((n) => n.coins.length > 1).length;

  const pictures = coins.length * VOYAGE_USD_PER_IMAGE;
  const creator = coins.length * CREATOR_POST_SHARE * X_USD_PER_POST;
  const perNarrative = SEARCH_RESULTS * X_USD_PER_POST + PICTURES_PER_SEARCH * VOYAGE_USD_PER_IMAGE + JUDGED_PER_SEARCH * JUDGE_USD_PER_POST;
  const searches = narratives.length * perNarrative;
  const total = pictures + creator + searches;
  const affordable = Math.max(0, Math.floor((H.pilotUsd - pictures - creator) / perNarrative));

  console.log(`source: ${file.source}${file.census ? '' : ' (lower bound)'}`);
  console.log(`alive coins: ${coins.length}`);
  console.log(`narratives: at most ${narratives.length} (${multi} with two or more coins); pictures and creator links can only merge these`);
  console.log('cost if every narrative is searched:');
  console.log(`  coin pictures embedded (${coins.length})      ${usd(pictures)}`);
  console.log(`  creator posts read by id (~${Math.round(coins.length * CREATOR_POST_SHARE)})  ${usd(creator)}`);
  console.log(`  one X search back per narrative at ${usd(perNarrative)}  ${usd(searches)}`);
  console.log(`  total                                ${usd(total)}   cap ${usd(H.pilotUsd)}`);
  console.log(total <= H.pilotUsd ? 'Fits the cap.' : `Over the cap: the pilot would stop after the biggest ~${affordable} narratives.`);
  console.log('Top 10 narratives by coins, then market cap today:');
  for (const n of narratives.slice(0, 10)) {
    console.log(`  ${n.title}  coins=${n.coins.length}  cap=${usd(Math.max(...n.coins.map((c) => c.marketCapUsd ?? 0)))}`);
  }
}

const command = process.argv[2];
if (command === 'counts') await counts();
else if (command === 'alive') await alive();
else if (command === 'estimate') estimate();
else {
  console.log('usage: tools/history-pilot.ts counts | alive | estimate');
  process.exit(1);
}
