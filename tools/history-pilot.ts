/**
 * THE HISTORY PILOT, STAGE BY STAGE: coins still alive today, grouped into narratives, priced
 * before anything is spent.
 *
 *   node --env-file=.env.local tools/history-pilot.ts counts     Dune stage 0 (needs DUNE_API_KEY; a few credits)
 *   node --env-file=.env.local tools/history-pilot.ts alive      today's alive coins (free; Dune if the key is set)
 *   node --env-file=.env.local tools/history-pilot.ts estimate   group them and price the pilot (free)
 *   node --env-file=.env.local tools/history-pilot.ts prepare    read each coin's metadata, add it to the universe (free)
 *   SPEND=live node --env-file=.env.local tools/history-pilot.ts run --yes
 *                                                                the paid step: prints its estimate per supplier,
 *                                                                then groups, finds origins, stops at the cap
 *
 * ★ `run` REFUSES unless SPEND=live is set AND --yes is passed, by the person, on the command
 * line. It stops at `universe.history.pilotUsd` in total across every run (the ledger,
 * internal.history_spend), and started again it resumes where it stopped.
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
import { inMemoryMeter } from '../adapters/meter/spend/src/index.ts';
import { assetFromSearch, chainClient, fetchMetadata } from '../adapters/venue/solana-pumpfun/src/index.ts';
import { asDb, createPool, DB_ROLE, PgAssetRepo, PgCoinUniverseRepo, PgHistoryRepo } from '../store/src/index.ts';
import { runPilot, type PilotCoin } from '../services/runner/src/work/history-pilot.ts';
import { pilotPorts } from './lib/pilot-ports.ts';
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

/* ── prepare: free reads, so the paid step knows each coin's picture and creator link ── */

const COINS_FILE = new URL('coins.json', OUT);
/* One metadata document every so often: a public gateway answers 429 to a burst. */
const METADATA_PACE_MS = 400;
const PAIR_USD = 0.003;

async function prepare(): Promise<void> {
  const file = JSON.parse(readFileSync(ALIVE_FILE, 'utf8')) as { coins: AliveCoin[] };
  const helius = process.env['HELIUS_API_KEY'] ?? '';
  if (helius === '') throw new Error('HELIUS_API_KEY is not set: the metadata link is read from the chain.');
  const chain = chainClient({ launchpadBaseUrl: '', rpcUrl: `https://mainnet.helius-rpc.com/?api-key=${helius}`, fetch: globalThis.fetch });
  /* --no-db: read and write coins.json only, so the estimate can be made before the database is migrated. */
  const pool = process.argv.includes('--no-db') ? null : createPool(DB_ROLE.internal, { applicationName: 'insidor-history-pilot' });
  const db = pool === null ? null : asDb(pool);
  const assets = db === null ? null : new PgAssetRepo(db);
  const universe = db === null ? null : new PgCoinUniverseRepo(db);
  const out: PilotCoin[] = [];
  /* Pictures straight from the chain, a hundred coins a call: no gateway needed. */
  const pictures = new Map<string, string>();
  for (let i = 0; i < file.coins.length; i += 100) {
    for (const [a, img] of await chain.imageUris(file.coins.slice(i, i + 100).map((c) => c.address))) pictures.set(a, img);
  }
  /* The creator's link is only in the metadata document: read through a gateway, paced, and
     once more after a pause when the gateway says to slow down. */
  const gateway = process.env['METADATA_GATEWAY'] ?? 'https://gateway.pinata.cloud';
  const readDoc = async (uri: string | null) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const read = await fetchMetadata(uri, { gateway, fetch: globalThis.fetch, timeoutMs: P.universe.metadataTimeoutMs, maxBytes: P.universe.metadataMaxBytes });
        return read.kind === 'read' ? read : null;
      } catch (e) {
        if (attempt === 0 && /429/.test(e instanceof Error ? e.message : '')) await sleep(30_000);
        else return null;
      }
    }
    return null;
  };
  for (const c of file.coins) {
    let uri: string | null = null;
    let meta = null;
    try {
      uri = await chain.metadataUri(c.address);
      meta = await readDoc(uri);
    } catch {
      meta = null;
    }
    await sleep(METADATA_PACE_MS);
    const now = Date.now() as never;
    const asset = assetFromSearch(
      { address: c.address, name: c.name, ticker: c.ticker, venue: c.bonded ? 'pool' : 'curve', marketAddress: null, createdAt: c.launchedAt, marketCapUsd: c.marketCapUsd, imageUrl: null, source: 'history' },
      { firstSeenAt: now, metadataUri: uri, chainCreatedAt: c.launchedAt as never },
    );
    if (asset !== null && assets !== null && universe !== null) {
      await assets.upsert([asset]);
      if (meta !== null) {
        const m = meta.metadata;
        await universe.recordMetadata(`solana:${c.address}`, { outcome: 'read', contentId: meta.cid, name: m.name, ticker: m.ticker, description: m.description, imageUri: m.imageUri, socialLink: m.links.social, website: m.links.website, chatLink: m.links.chat }, now);
      }
    }
    out.push({ address: c.address, name: meta?.metadata.name ?? c.name, ticker: meta?.metadata.ticker ?? c.ticker, launchedAt: c.launchedAt as never, marketCapUsd: c.marketCapUsd, imageUri: meta?.metadata.imageUri ?? pictures.get(c.address) ?? null, socialLink: meta?.metadata.links.social ?? null });
    if (out.length % 50 === 0) console.log(`  ${out.length} of ${file.coins.length}`);
  }
  await pool?.end();
  writeFileSync(COINS_FILE, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`prepared ${out.length} coins: ${out.filter((c) => c.imageUri !== null).length} with a picture, ${out.filter((c) => c.socialLink !== null).length} with a creator link.`);
}

/* ── run: the paid step ─────────────────────────────────────────────── */

function pilotEstimate(coins: readonly PilotCoin[]) {
  const key = (s: string | null) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  let pairs = 0;
  const pictured = new Set<string>();
  for (let i = 0; i < coins.length; i += 1) {
    for (let j = i + 1; j < coins.length; j += 1) {
      const a = coins[i];
      const b = coins[j];
      if (a === undefined || b === undefined) continue;
      if ((key(a.name) !== '' && key(a.name) === key(b.name)) || (key(a.ticker) !== '' && key(a.ticker) === key(b.ticker))) {
        pairs += 1;
        if (a.imageUri !== null) pictured.add(a.imageUri);
        if (b.imageUri !== null) pictured.add(b.imageUri);
      }
    }
  }
  const narratives = groupCoins(coins.map((c) => ({ address: c.address, name: c.name, ticker: c.ticker, launchedAt: c.launchedAt, marketCapUsd: c.marketCapUsd, linkedPost: null })), [], P).length;
  const xLinks = coins.filter((c) => c.socialLink !== null && /(?:x|twitter)\.com\/[^/]+\/status\//.test(c.socialLink)).length;
  const confirms = Math.ceil(pairs * 0.2) + narratives * 2;
  const searchPictures = narratives * PICTURES_PER_SEARCH;
  const lines = {
    voyage: { calls: pictured.size + searchPictures, usd: (pictured.size + searchPictures) * VOYAGE_USD_PER_IMAGE },
    x: { calls: xLinks + narratives, usd: xLinks * X_USD_PER_POST + narratives * SEARCH_RESULTS * X_USD_PER_POST },
    anthropic: { calls: confirms + xLinks + narratives * JUDGED_PER_SEARCH, usd: confirms * PAIR_USD + xLinks * JUDGE_USD_PER_POST + narratives * JUDGED_PER_SEARCH * JUDGE_USD_PER_POST },
  };
  return { narratives, pairs, xLinks, searches: narratives, imageChecks: pictured.size + searchPictures, confirms, lines, total: lines.voyage.usd + lines.x.usd + lines.anthropic.usd };
}

async function run(): Promise<void> {
  const coins = JSON.parse(readFileSync(COINS_FILE, 'utf8')) as PilotCoin[];
  const e = pilotEstimate(coins);
  console.log('The pilot, priced before anything is sent:');
  console.log(`  narratives (at most)       ${e.narratives}`);
  console.log(`  pairs compared by picture  ${e.pairs}`);
  console.log(`  X searches back (at most)  ${e.searches}`);
  console.log(`  creator posts read on X    ${e.xLinks}`);
  console.log(`  Claude calls (about)       ${e.lines.anthropic.calls}`);
  console.log(`  image checks (at most)     ${e.imageChecks}`);
  for (const [supplier, l] of Object.entries(e.lines)) console.log(`  ${supplier.padEnd(10)} ${String(l.calls).padStart(6)} calls  ${usd(l.usd)}`);
  console.log(`  total about ${usd(e.total)}; the cap is ${usd(H.pilotUsd)} across every run.`);

  if (process.env['SPEND'] !== 'live' || !process.argv.includes('--yes')) {
    console.log('Not run. The pilot spends money: start it yourself with SPEND=live and --yes.');
    return;
  }
  const pool = createPool(DB_ROLE.internal, { applicationName: 'insidor-history-pilot' });
  const history = new PgHistoryRepo(asDb(pool));
  const left = Math.max(0, H.pilotUsd - (await history.spent()));
  const meter = inMemoryMeter({ dailyCapUsd: left, softStop: 1, now: Date.now });
  const reserve = {
    pictures: 2 * VOYAGE_USD_PER_IMAGE,
    confirm: PAIR_USD,
    creator: X_USD_PER_POST + JUDGE_USD_PER_POST,
    search: SEARCH_RESULTS * X_USD_PER_POST + PICTURES_PER_SEARCH * VOYAGE_USD_PER_IMAGE + JUDGED_PER_SEARCH * PAIR_USD,
  };
  const log = { info: (m: string, f?: object) => console.log(m, f ?? ''), warn: (m: string, f?: object) => console.warn(m, f ?? ''), error: (m: string, f?: object) => console.error(m, f ?? ''), child: () => log };
  const result = await runPilot(coins, { ports: pilotPorts({ out: OUT, meter, policy: P, env: process.env }), reserve, history, policy: P, log: log as never, now: () => Date.now() as never });
  await pool.end();
  console.log(result.stopped === 'cap' ? `Stopped at the cap: $${result.spentUsd.toFixed(4)} spent in total, ${result.remaining} left. Run again after raising the cap.` : `Done: $${result.spentUsd.toFixed(4)} spent in total.`, result);
}

const command = process.argv[2];
if (command === 'counts') await counts();
else if (command === 'alive') await alive();
else if (command === 'estimate') estimate();
else if (command === 'prepare') await prepare();
else if (command === 'run') await run();
else {
  console.log('usage: tools/history-pilot.ts counts | alive | estimate | prepare | run');
  process.exit(1);
}
