/**
 * `node --env-file=.env.local --experimental-strip-types tools/repair-stock-launches.ts [--yes] [--pages <n>] [--also <addr,addr>]`
 *
 * REPAIR THE LAUNCHES FILED UNDER THE TOKEN THEY WERE PAIRED AGAINST. Until 21 Oct 2026 the launch
 * socket put a launch's PAIRED token (a tokenised stock such as MSTRx, or USDC) where the new
 * coin's address belongs, beside the new coin's name: MSTRx stood in public.asset as "LAURA" and
 * in the name index as "Junior USD*" (its first sighting, kept forever by 0037), and the meme
 * Laura (Cg9z…pump) had no row. The socket and the listing are fixed (stream.ts, 0121); this
 * repairs what they already wrote.
 *
 * WHAT IT DOES, per suspect (a launch row whose address is SOL/USDC/USDT/USD1, or carries the
 * tokenised stocks' `Xs…` prefix without the launchpad's `pump` suffix, or is named with --also):
 *   1. asks the market (GeckoTerminal, free, paced under its limit) for the token's own name and
 *      its pools. It is CONFIRMED paired when the market names it a tokenised stock ("… xStock"),
 *      or it is the quote side of at least one launchpad pool (curve or graduated) — and, either
 *      way, the curve base of none — a token with a curve of its own is a coin, and
 *      a coin other coins are paired against keeps its row. SOL and the stablecoins are confirmed
 *      by name: their pages are too deep for a launchpad pool to show.
 *   2. marks each confirmed token `paired_token` (PgAssetRepo.markPaired, the same write
 *      chainwatch makes): its market name and symbol, the meme's launch facts cleared, out of
 *      every read of launches, and never renamed again by a launch frame.
 *   3. corrects its name index row. ★ 0037's trigger only ever INSERTS (`on conflict do
 *      nothing`) and only on an asset insert, so a first sighting is never rewritten by any
 *      write to public.asset — which is how "Junior USD*" survived every later rename. markPaired
 *      therefore UPDATES public.coin_name directly: the market's name and ticker, launch time
 *      null (the token was never launched here). The trigger cannot undo it: a paired row is
 *      never re-inserted, and its origin is outside the trigger's two.
 *   4. adds the memes launched against it that we hold no row for: each base token of its
 *      launchpad pools, as a `backfill` row (the listing's own write: added only when no row
 *      exists), named as the market names it, launched at its curve pool's creation, or with an
 *      unknown launch time when only its graduated pool is listed. The trigger gives each a name
 *      index row.
 *
 * DRY RUN BY DEFAULT: the database is read inside a READ ONLY transaction and nothing is written;
 * the plan is printed. `--yes` writes it in one transaction, and only once 0121 is applied (the
 * origin CHECK must allow `paired_token`), refusing otherwise. `--pages` is how many pool pages
 * per token are read (20 pools a page; default 2, at most 10). Measured 21 Oct on the free API: a
 * stock's first pages are its large listed pools, so the memes launched against it sit deeper
 * than a keyless run can afford to read; the listing (chainwatch) adds every new one as it
 * launches, and a deeper read is `--pages 10` on a quiet afternoon.
 *
 * What it does NOT do: repoint picks, links or watches that name a marked token (they are listed
 * for the owner instead), or find a coin-paired-against-coin rename (a real coin's row renamed by
 * a coin launched against it) — that row is a coin and keeps its address; its name is the one
 * thing wrong and the token page already prefers the market's.
 */

import process from 'node:process';

import type { Millis } from '../contracts/src/index.ts';
import { chainId, venueId } from '../contracts/src/ids.ts';
import type { CoinSearchHit } from '../contracts/src/ports/coin-search.ts';
import { BASE_URLS } from '../adapters/market/geckoterminal/src/index.ts';
import { assetFromSearch } from '../adapters/venue/solana-pumpfun/src/search-asset.ts';
import { asDb, createPool, DB_ROLE, PgAssetRepo } from '../store/src/index.ts';

const CHAIN = chainId('solana');
const VENUE = venueId(CHAIN, 'pumpfun');
/** Old, famous, never launched here: confirmed without asking the market. */
const FAMOUS: Readonly<Record<string, string>> = {
  '11111111111111111111111111111111': 'SOL',
  So11111111111111111111111111111111111111112: 'wrapped SOL',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
  USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB: 'USD1',
};
/** How the market names a tokenised stock: "MicroStrategy xStock", "SP500 xStock". */
const STOCK_NAME = /\bxStock$/i;
const LAUNCHPAD_DEX: Readonly<Record<string, 'curve' | 'pool'>> = { 'pump-fun': 'curve', pumpswap: 'pool' };
/** Under the free API's limit of ~30 a minute for one address. */
const PACE_MS = 2_500;
const REFUSED_RETRIES = 4;
const REFUSED_WAIT_MS = 20_000;
const TIMEOUT_MS = 15_000;
const POOLS_PER_PAGE = 20;

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const write = process.argv.includes('--yes');
const pages = Math.min(10, Math.max(1, Number(arg('--pages', '2')) || 2));
const also = arg('--also', '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);

/* ── the market, read keyless and paced ──────────────────────────────────── */

let lastAt = 0;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function gecko(path: string): Promise<unknown> {
  /* The free API's limit is per address and shared with whatever else runs here: a refusal (429)
     waits and asks again, longer each time, before the token is reported unread. */
  for (let attempt = 0; ; attempt += 1) {
    const wait = lastAt + PACE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    const res = await fetch(`${BASE_URLS.free}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 404) return null;
    if (res.status === 429 && attempt < REFUSED_RETRIES) {
      await sleep(REFUSED_WAIT_MS * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`market responded ${res.status} for ${path.split('?')[0]}`);
    return res.json();
  }
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const idOf = (v: unknown): string | null => {
  const id = str(rec(rec(v).data).id);
  return id !== null && id.startsWith('solana_') ? id.slice('solana_'.length) : null;
};

interface Meme {
  address: string;
  name: string | null;
  symbol: string | null;
  /** The earliest curve pool's creation: the launch, bounded. Null when only a graduated pool is listed. */
  curveCreatedAt: number | null;
  marketAddress: string | null;
  venue: 'curve' | 'pool';
}

interface Evidence {
  readonly address: string;
  readonly name: string | null;
  readonly symbol: string | null;
  readonly quoteOf: number;
  readonly baseOf: number;
  readonly pagesRead: number;
  readonly memes: Map<string, Meme>;
  readonly error: string | null;
}

async function evidence(address: string): Promise<Evidence> {
  const memes = new Map<string, Meme>();
  let name: string | null = null;
  let symbol: string | null = null;
  let quoteOf = 0;
  let baseOf = 0;
  let pagesRead = 0;
  try {
    const token = rec(rec(rec(await gecko(`/networks/solana/tokens/${address}`)).data).attributes);
    name = str(token.name);
    symbol = str(token.symbol);
    for (let page = 1; page <= pages; page += 1) {
      const raw = rec(await gecko(`/networks/solana/tokens/${address}/pools?page=${page}&include=base_token,quote_token,dex`));
      pagesRead += 1;
      const names = new Map<string, { name: string | null; symbol: string | null }>();
      for (const t of arr(raw.included)) {
        const id = str(rec(t).id);
        if (id === null || !id.startsWith('solana_') || str(rec(t).type) !== 'token') continue;
        const a = rec(rec(t).attributes);
        names.set(id.slice('solana_'.length), { name: str(a.name), symbol: str(a.symbol) });
      }
      const rows = arr(raw.data);
      for (const p of rows) {
        const rel = rec(rec(p).relationships);
        const venue = LAUNCHPAD_DEX[idOf(rel.dex) ?? ''];
        if (venue === undefined) continue;
        const base = idOf(rel.base_token);
        const quote = idOf(rel.quote_token);
        if (base === address) baseOf += venue === 'curve' ? 1 : 0;
        if (quote !== address || base === null || base === address) continue;
        quoteOf += 1;
        const a = rec(rec(p).attributes);
        const created = str(a.pool_created_at);
        const createdMs = venue === 'curve' && created !== null ? Date.parse(created) : null;
        const seen = memes.get(base);
        const n = names.get(base);
        if (seen === undefined) {
          memes.set(base, { address: base, name: n?.name ?? null, symbol: n?.symbol ?? null, curveCreatedAt: createdMs, marketAddress: str(a.address), venue });
        } else if (createdMs !== null && (seen.curveCreatedAt === null || createdMs < seen.curveCreatedAt)) {
          seen.curveCreatedAt = createdMs;
          seen.venue = 'curve';
          seen.marketAddress = str(a.address);
        }
      }
      if (rows.length < POOLS_PER_PAGE) break;
    }
    return { address, name, symbol, quoteOf, baseOf, pagesRead, memes, error: null };
  } catch (e) {
    return { address, name, symbol, quoteOf, baseOf, pagesRead, memes, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ── the run ─────────────────────────────────────────────────────────────── */

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-repair-stock-launches' });
const client = await pool.connect();
const db = asDb(client);
let committed = false;
try {
  await client.query(write ? 'begin' : 'begin read only');

  const suspects = await db.query<{ address: string; origin: string; name: string | null; symbol: string | null; index_name: string | null; index_ticker: string | null; first_seen_at: Date }>(
    `select a.address, a.origin, a.name, a.symbol, n.name as index_name, n.ticker as index_ticker, a.first_seen_at
       from public.asset a left join public.coin_name n on n.address = a.address
      where a.chain = $1 and a.origin in ('live_stream', 'backfill')
        and (a.address = any($2::text[]) or (a.address like 'Xs%' and a.address not like '%pump'))
      order by a.first_seen_at`,
    [CHAIN, [...Object.keys(FAMOUS), ...also]],
  );
  console.log(`${write ? 'WRITE' : 'DRY RUN'}: ${suspects.length} suspect launch rows; reading the market for each (${pages} pool page(s) a token, ${PACE_MS / 1000}s apart)\n`);

  const confirmed: { address: string; symbol: string | null; name: string | null }[] = [];
  const memes = new Map<string, Meme>();
  for (const s of suspects) {
    const famous = FAMOUS[s.address];
    const ev = await evidence(s.address);
    /* The market's own name says a tokenised stock outright ("NVIDIA xStock"); a token that is the
       quote of a launchpad pool and the curve base of none says it by its pools. */
    const stock = ev.name !== null && STOCK_NAME.test(ev.name);
    const paired = famous !== undefined || (ev.baseOf === 0 && (stock || (ev.error === null && ev.quoteOf > 0)));
    const verdict = paired ? 'PAIRED' : ev.error !== null ? 'UNREAD' : ev.baseOf > 0 ? 'COIN' : 'NO EVIDENCE';
    console.log(`${verdict.padEnd(11)} ${s.address}  stored "${s.name ?? '—'}"/${s.symbol ?? '—'}  index "${s.index_name ?? '—'}"/${s.index_ticker ?? '—'}  market "${ev.name ?? famous ?? '—'}"/${ev.symbol ?? '—'}  quote of ${ev.quoteOf} launchpad pool(s), curve base of ${ev.baseOf}, ${ev.memes.size} meme(s)${ev.error !== null ? `  [${ev.error}]` : ''}`);
    if (!paired) continue;
    confirmed.push({ address: s.address, symbol: ev.symbol ?? famous ?? s.symbol, name: ev.name ?? famous ?? null });
    for (const m of ev.memes.values()) if (!memes.has(m.address)) memes.set(m.address, m);
  }

  const held = await db.query<{ address: string; origin: string; name: string | null }>('select address, origin, name from public.asset where chain = $1 and address = any($2::text[])', [CHAIN, [...memes.keys()]]);
  const heldBy = new Map(held.map((h) => [h.address, h]));
  const missing = [...memes.values()].filter((m) => !heldBy.has(m.address));
  console.log(`\n${confirmed.length} token(s) to mark paired; ${memes.size} meme(s) launched against them on the pages read, ${memes.size - missing.length} already held, ${missing.length} to add:`);
  for (const m of [...memes.values()].sort((a, b) => (a.curveCreatedAt ?? 0) - (b.curveCreatedAt ?? 0))) {
    const h = heldBy.get(m.address);
    console.log(`  ${h === undefined ? 'ADD ' : 'held'} ${m.address}  "${m.name ?? '—'}"/${m.symbol ?? '—'}  launched ${m.curveCreatedAt === null ? '— (only a graduated pool listed)' : new Date(m.curveCreatedAt).toISOString()}${h === undefined ? '' : `  (stored as ${h.origin} "${h.name ?? '—'}")`}`);
  }

  /* What still points at a marked token, for the owner: nothing here repoints it. */
  const marked = confirmed.map((c) => c.address);
  const pointers = await db.query<{ what: string; n: string }>(
    `select 'coin_post_link' as what, count(*)::text as n from internal.coin_post_link where address = any($1::text[])
     union all select 'post_coin_pick', count(*)::text from internal.post_coin_pick where address = any($1::text[])
     union all select 'narrative_coin_pick', count(*)::text from internal.narrative_coin_pick where address = any($1::text[])
     union all select 'coin_watch', count(*)::text from internal.coin_watch where address = any($1::text[])`,
    [marked],
  );
  console.log(`\nRows elsewhere naming a token to be marked (left as they are): ${pointers.map((p) => `${p.what} ${p.n}`).join(', ')}`);

  if (!write) {
    console.log('\nDry run: nothing written. Pass --yes to write.');
  } else {
    const [check] = await db.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'origin_is_a_known_kind' and conrelid = 'public.asset'::regclass");
    if (!(check?.def ?? '').includes('paired_token')) throw new Error("refused: 0121 is not applied here (the origin CHECK does not allow 'paired_token'); deploy it first");
    const assets = new PgAssetRepo(db);
    const now = Date.now() as Millis;
    const changed = await assets.markPaired(CHAIN, VENUE, confirmed, now);
    const rows = missing.flatMap((m) => {
      const hit: CoinSearchHit = { address: m.address, name: m.name, ticker: m.symbol, venue: m.venue, marketAddress: m.marketAddress, createdAt: m.curveCreatedAt, marketCapUsd: null, imageUrl: null, source: 'geckoterminal' };
      const asset = assetFromSearch(hit, { firstSeenAt: now, metadataUri: null, chainCreatedAt: null });
      return asset === null ? [] : [asset];
    });
    const added = await assets.addListed(rows);
    await client.query('commit');
    committed = true;
    console.log(`\nWritten: ${changed.length} token row(s) marked paired, ${added.length} meme row(s) added.`);
  }
} finally {
  if (!committed) await client.query('rollback').catch(() => undefined);
  client.release();
  await pool.end();
}
