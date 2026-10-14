/**
 * `node --env-file=.env.local --experimental-strip-types tools/name-backfill.ts <snapshot | guess | search | diff> …`
 *
 * THE NAMER, BACKFILLED ONTO EVERY CARD ALREADY ON FOR YOU, POPULAR AND THE SCROLL (the owner,
 * 2026-10-14: "so existing cards get the better coins and the shorter See N coins list straight
 * away, not just new posts. Tell me how many cards changed coin, and list them").
 *
 *   snapshot --out <file.json>       every feed card's coin line now (tools/lib/feed-cards.ts). Free.
 *   guess --yes [--cap <usd>]        the namer on every feed card with no guess under its current
 *                                    prompt — the runner's own step (services/runner
 *                                    work/name-guesses.ts) with the feed scope widened to every
 *                                    scroll member — on the LIVE book (SPEND=live), refused past
 *                                    --cap (default $1). ~230 cards at $0.0016: ~$0.40.
 *   search [--minutes <n>]           every guessed feed card searched again under its names and the
 *                                    namer's (the runner's own coin lookup, services/runner
 *                                    work/coin-lookup.ts), inside the lookup's per-minute and per-day
 *                                    caps, which it shares with the runner: free reads, paced, until
 *                                    every card is searched or --minutes (default 90) pass. The runner
 *                                    re-searches only live cards, and only after six hours; without
 *                                    this an older card would keep the coins its first search found.
 *   diff --before <a> --after <b> --out <file.md>
 *                                    the cards whose coin changed, or whose "See N coins" count
 *                                    changed: post, excerpt, old coin → new coin, old N → new N.
 *
 * Order: snapshot (before), guess, search, wait for the projector (every minute) to re-project, snapshot
 * (after), diff. The watch's baseline (tools/name-watch.ts baseline) is taken with the first snapshot.
 *
 * What breaks if changed carelessly: `search` must go through the runner's own lookup, never a copy:
 * the coins it records are the ones the projector weighs, and a search done another way would show
 * the owner coins the live feed would never find.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import type { Millis } from '../contracts/src/index.ts';
import { DEFAULT_POLICY as P, type Policy } from '../contracts/src/policy.ts';
import { voyageEmbed, httpClient as voyageClient } from '../adapters/embed/voyage/src/index.ts';
import { httpClient as judgeClient } from '../adapters/judge/anthropic/src/index.ts';
import { anthropicNamer } from '../adapters/judge/anthropic/src/name-guess.ts';
import { dexscreenerSearch } from '../adapters/market/dexscreener/src/index.ts';
import { geckoterminal } from '../adapters/market/geckoterminal/src/index.ts';
import { chainClient } from '../adapters/venue/solana-pumpfun/src/index.ts';
import { loadRunnerConfig } from '../services/runner/src/config.ts';
import { createLogger } from '../services/runner/src/log.ts';
import { lookUpCoins } from '../services/runner/src/work/coin-lookup.ts';
import { nameGuesser } from '../services/runner/src/work/name-guesses.ts';
import { asDb, createPool, DB_ROLE, PgAssetRepo, PgCoinUniverseRepo, PgNameExampleRepo, PgNameGuessRepo, PgOlderCoinRepo } from '../store/src/index.ts';
import { feedCards, type FeedCard } from './lib/feed-cards.ts';
import { judgeSetup } from './lib/pass-rates.ts';
import { openSharedMeter } from './lib/shared-meter.ts';

const command = process.argv[2] ?? '';
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/* Every scroll member, however long ago it was shown: the owner asked for all of them. */
const ALL_MEMBERS_MS = 365 * DAY_MS;
const SEARCH_TIMEOUT_MS = 8_000;

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-name-backfill' });
const db = asDb(pool);
const log = createLogger({ tool: 'name-backfill' });

async function snapshot(): Promise<void> {
  const out = arg('--out', 'var/name-cards.json');
  const cards = await feedCards(db);
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), cards }, null, 1));
  console.log(`${cards.length} cards (${cards.filter((c) => c.address !== null).length} showing a coin, ${cards.filter((c) => c.claimCount !== null).length} with See N coins) → ${out}`);
}

async function guess(): Promise<void> {
  if (process.env['SPEND'] !== 'live' || !process.argv.includes('--yes')) {
    console.error('guess refused: the namer costs money on the live book. Set SPEND=live and pass --yes.');
    process.exitCode = 2;
    return;
  }
  const cap = Number(arg('--cap', '1'));
  const { meter, close } = await openSharedMeter(cap, process.env, 'live');
  try {
    const cards = await feedCards(db);
    const { setup, price } = judgeSetup(process.env);
    const client = judgeClient({
      apiKey: setup.apiKey, baseUrl: setup.baseUrl, model: setup.model, maxOutputTokens: P.names.maxOutputTokens, effort: price.effort,
      timeoutMs: P.judge.timeoutMs, maxAttempts: P.judge.maxAttempts, backoffMs: P.judge.backoffMs, maxWaitMs: P.judge.maxWaitMs,
      maxFrameBytes: P.judge.maxFrameBytes, pictureSize: 'small', fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    });
    const namer = anthropicNamer({ client, meter, now: () => Date.now() as Millis, model: setup.model, judge: P.judge, names: P.names, effort: price.effort });
    /* The runner's own step, its scope widened to every scroll member and its pass to every card. */
    const policy: Policy = { ...P, names: { ...P.names, on: true, feedOnly: true, windowMs: ALL_MEMBERS_MS, perPass: cards.length } };
    const embed = voyageEmbed({ client: voyageClient({ apiKey: (process.env['VOYAGE_API_KEY'] ?? '').trim(), baseUrl: process.env['VOYAGE_API_BASE'] ?? 'https://api.voyageai.com', fetch: globalThis.fetch }), meter, now: () => Date.now() as Millis });
    const step = nameGuesser({
      namer, embed, meter, mode: 'live', policy, log, now: () => Date.now() as Millis,
      examples: new PgNameExampleRepo(db), guesses: new PgNameGuessRepo(db),
    });
    const r = await step.pass();
    console.log(`${cards.length} feed cards: ${r.guessed} guessed, ${r.absent} with no answer (asked again by the runner)${r.skipped === null ? '' : `, skipped: ${r.skipped}`}; namer $${r.usd.toFixed(4)}, all spend $${meter.spentUsd().toFixed(4)} on the live book`);
  } finally {
    await close();
  }
}

/** Each guessed feed card as a lookup term: the judge's name first (or the namer's first guess when the judge named nothing), then the judge's others. */
async function termsFor(ids: readonly string[]) {
  const rows = await db.query<{ item_id: string; proposed_name: string | null; alternate_names: unknown; first_guess: string | null }>(
    `select g.item_id, j.proposed_name, j.alternate_names, g.name as first_guess
       from internal.name_guess g
       left join lateral (select pj.proposed_name, pj.alternate_names from internal.post_judgement pj
                           where pj.item_id = g.item_id and pj.prompt_id not like 'post-kind%' and pj.proposed_name is not null
                           order by pj.judged_at desc, pj.id desc limit 1) j on true
      where g.rank = 0 and g.item_id = any($1::text[])`,
    [[...ids]],
  );
  return rows.map((r) => {
    const term = r.proposed_name ?? r.first_guess ?? '';
    const alternates = Array.isArray(r.alternate_names) ? r.alternate_names.filter((n): n is string => typeof n === 'string' && n.trim() !== '') : [];
    return { kind: 'post' as const, id: r.item_id, term, names: [...new Set([term, ...alternates])], attempts: 0 };
  }).filter((t) => t.term.trim() !== '');
}

async function search(): Promise<void> {
  const cfg = loadRunnerConfig(process.env);
  const until = Date.now() + Number(arg('--minutes', '90')) * MINUTE_MS;
  const cards = await feedCards(db);
  const left = new Set(cards.map((c) => c.itemId));
  const universe = new PgCoinUniverseRepo(db);
  const policy: Policy = { ...P, names: { ...P.names, on: true } };
  const sources = [
    dexscreenerSearch({ baseUrl: 'https://api.dexscreener.com', fetch: globalThis.fetch, timeoutMs: SEARCH_TIMEOUT_MS }),
    geckoterminal({ ...cfg.marketData, fetch: globalThis.fetch, timeoutMs: SEARCH_TIMEOUT_MS, now: Date.now }),
  ];
  let searched = 0;
  while (left.size > 0 && Date.now() < until) {
    const terms = await termsFor([...left]);
    if (terms.length === 0) break;
    const handed = new Set<string>();
    /* The runner's lookup, handed these cards instead of its own queue; its caps decide how many a pass. */
    const coins: Parameters<typeof lookUpCoins>[0]['coins'] = {
      queueLookups: async () => 0,
      lookupTerms: async (_keep: Millis, _retries: number, limit: number) => {
        const take = terms.slice(0, limit);
        for (const t of take) handed.add(t.id);
        return take;
      },
      withGuesses: universe.withGuesses.bind(universe),
      recordLookup: universe.recordLookup.bind(universe),
      recordFailedLookup: universe.recordFailedLookup.bind(universe),
      searchesSince: universe.searchesSince.bind(universe),
      knownAssets: universe.knownAssets.bind(universe),
    };
    const r = await lookUpCoins({
      older: new PgOlderCoinRepo(db), coins, assets: new PgAssetRepo(db), sources,
      chain: cfg.chainRpcUrl === null ? null : chainClient({ launchpadBaseUrl: '', rpcUrl: cfg.chainRpcUrl, fetch: globalThis.fetch }),
      policy, log, now: () => Date.now() as Millis,
    });
    for (const id of handed) left.delete(id);
    for (const c of cards) if (!terms.some((t) => t.id === c.itemId)) left.delete(c.itemId);
    searched += r.searched;
    console.log(`searched ${searched} cards (${r.added} new coins this pass, ${r.failed} failed); ${left.size} left`);
    if (left.size > 0) await new Promise((res) => setTimeout(res, MINUTE_MS));
  }
  console.log(left.size === 0 ? 'every guessed card searched; the projector shows the new coins on its next run (every minute)' : `stopped with ${left.size} cards unsearched; run again to finish`);
}

function diff(): void {
  const read = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as { at: string; cards: FeedCard[] };
  const before = read(arg('--before', 'var/name-cards-before.json'));
  const after = read(arg('--after', 'var/name-cards-after.json'));
  const out = arg('--out', 'var/name-backfill-diff.md');
  const was = new Map(before.cards.map((c) => [c.itemId, c] as const));
  const coin = (c: FeedCard | undefined) => (c === undefined ? 'not on a feed' : c.address === null ? (c.kind === 'unsure' ? 'no coin shown' : `no coin (${c.kind ?? 'not projected'})`) : `${c.name ?? ''} $${c.ticker ?? ''} (${c.address.slice(0, 6)}…)`);
  const n = (c: FeedCard | undefined) => (c?.claimCount === null || c?.claimCount === undefined ? '—' : String(c.claimCount));
  const changedCoin = after.cards.filter((c) => was.has(c.itemId) && was.get(c.itemId)?.address !== c.address);
  const changedN = after.cards.filter((c) => was.has(c.itemId) && was.get(c.itemId)?.address === c.address && was.get(c.itemId)?.claimCount !== c.claimCount);
  const gained = changedCoin.filter((c) => was.get(c.itemId)?.address === null && c.address !== null).length;
  const lost = changedCoin.filter((c) => was.get(c.itemId)?.address !== null && c.address === null).length;
  const shorter = changedN.filter((c) => (c.claimCount ?? 0) < (was.get(c.itemId)?.claimCount ?? 0)).length;
  const row = (c: FeedCard) => `| ${c.itemId} | ${c.excerpt.replace(/\|/g, '/').slice(0, 70)} | ${coin(was.get(c.itemId))} | ${coin(c)} | ${n(was.get(c.itemId))} → ${n(c)} |`;
  const lines = [
    `# Namer backfill: feed cards before (${before.at}) and after (${after.at})`,
    '',
    `${after.cards.length} cards on For You, Popular and the scroll. **${changedCoin.length} changed coin** (${gained} gained one, ${lost} lost one, ${changedCoin.length - gained - lost} switched to another). ${changedN.length} kept their coin line but changed their See N coins count (${shorter} shorter).`,
    '',
    '## Cards that changed coin',
    '',
    '| Post | Excerpt | Old coin | New coin | See N |',
    '|---|---|---|---|---|',
    ...changedCoin.map(row),
    '',
    '## Cards whose See N coins count changed',
    '',
    '| Post | Excerpt | Old coin | New coin | See N |',
    '|---|---|---|---|---|',
    ...changedN.map(row),
    '',
  ];
  writeFileSync(out, lines.join('\n'));
  console.log(`${changedCoin.length} cards changed coin (${gained} gained, ${lost} lost); ${changedN.length} changed See N (${shorter} shorter) → ${out}`);
}

try {
  if (command === 'snapshot') await snapshot();
  else if (command === 'guess') await guess();
  else if (command === 'search') await search();
  else if (command === 'diff') diff();
  else {
    console.error('name-backfill: one of snapshot, guess, search, diff');
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
