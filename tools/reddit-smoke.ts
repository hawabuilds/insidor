/**
 * ★ NOT A TEST. It touches the network on purpose.
 *
 * `pnpm test` does not run it, CI does not run it, and nothing imports it. The
 * house rule that tests must never reach a vendor is what makes the whole
 * adapter unit-testable with an injected `fetch`; this file is the other half
 * of that arrangement — the one place where somebody deliberately asks the real
 * thing whether our beliefs about it are true. Delete it once the fixtures are
 * recordings and the questions below are answered.
 *
 *     node --experimental-strip-types tools/reddit-smoke.ts [community]
 *
 * ── WHAT IT IS FOR ────────────────────────────────────────────────────────
 *
 * Everything the reddit adapter claims about field names comes from this
 * vendor's open-sourced serialiser and its reference client's documentation,
 * because there were no credentials when the package was written. Four of those
 * claims decide real behaviour and can only be settled by a live payload:
 *
 *   1. Is `num_crossposts` present? If it is, `reproduction` is promoted out of
 *      `capabilities.absent` — the product's central signal, currently declared
 *      missing on this source out of caution.
 *   2. Is `upvote_ratio` in a LISTING, or only on a single-post read?
 *   3. Is `author_fullname` present on both endpoints?
 *   4. Does `hide_score` behave as documented on a very young post, and what
 *      number rides alongside it when it is true?
 *
 * It prints the answers rather than asserting them, because the point is to
 * learn what the vendor actually sends, not to confirm what we guessed.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

import { inMemoryMeter } from '../adapters/meter/spend/src/index.ts';
import {
  httpClient,
  postUrl,
  postUrlFromPath,
  redditPlatform,
  RATE_LIMIT_PER_MIN,
} from '../adapters/platform/reddit/src/index.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ── the three variables ──────────────────────────────────────────────── */

function envFile(): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const cut = trimmed.indexOf('=');
    if (cut <= 0) continue;
    out[trimmed.slice(0, cut)] = trimmed.slice(cut + 1).trim();
  }
  return out;
}

/**
 * ★ SKIP LOUDLY, AND NAME WHICH ONE IS MISSING.
 *
 * A smoke check that quietly does nothing is worse than one that fails: it
 * reports success on a source nobody has ever actually reached. So it says, in
 * full, which variable is empty and what to do about it — and it exits 0,
 * because "we were never configured" is not the same failure as "the vendor is
 * down", and this script is the wrong place to conflate them.
 *
 * ★ AND IT REFUSES THE PLACEHOLDER USER AGENT. `insidor/0.1 by
 * /u/YOUR_REDDIT_USERNAME` is not a contactable identity, and this vendor's
 * rule is quoted and unambiguous: never lie about your user agent. Sending a
 * placeholder is a small lie that costs the app rather than the script.
 */
function credentials(): { clientId: string; clientSecret: string; userAgent: string } | null {
  const env = { ...envFile(), ...process.env };
  const missing: string[] = [];

  const clientId = (env.REDDIT_CLIENT_ID ?? '').trim();
  const clientSecret = (env.REDDIT_CLIENT_SECRET ?? '').trim();
  const userAgent = (env.REDDIT_USER_AGENT ?? '').trim();

  if (clientId.length === 0) missing.push('REDDIT_CLIENT_ID is empty');
  if (clientSecret.length === 0) missing.push('REDDIT_CLIENT_SECRET is empty');
  if (userAgent.length === 0) missing.push('REDDIT_USER_AGENT is empty');
  else if (/your_reddit_username/i.test(userAgent)) {
    missing.push(`REDDIT_USER_AGENT is still the placeholder (${JSON.stringify(userAgent)})`);
  } else if (!/\/u\/[A-Za-z0-9_-]{3,}/.test(userAgent)) {
    missing.push(`REDDIT_USER_AGENT names no contactable account (${JSON.stringify(userAgent)})`);
  }

  if (missing.length === 0) return { clientId, clientSecret, userAgent };

  console.log('');
  console.log('═'.repeat(78));
  console.log('  SKIPPED — the reddit smoke check made NO network call.');
  console.log('═'.repeat(78));
  for (const reason of missing) console.log(`  ✗ ${reason}`);
  console.log('');
  console.log('  Nothing about this source has been verified against the live API. Every');
  console.log('  field name the adapter uses still rests on a document rather than on a');
  console.log('  payload, and src/__fixtures__/posts.ts is hand-built, not recorded.');
  console.log('');
  console.log('  To fix, in .env.local (gitignored — never commit these):');
  console.log('    1. Create a "script" app at https://www.reddit.com/prefs/apps');
  console.log('       type must be "script"; redirect uri http://localhost');
  console.log('    2. REDDIT_CLIENT_ID     = the short string under the app name');
  console.log('       REDDIT_CLIENT_SECRET = the field labelled "secret"');
  console.log('       REDDIT_USER_AGENT    = script:com.insidor.adapter:v0.1.0 (by /u/<you>)');
  console.log('');
  console.log('  The grant is client_credentials — app id and app secret only.');
  console.log('  NO REDDIT ACCOUNT PASSWORD IS NEEDED OR WANTED by this adapter.');
  console.log('═'.repeat(78));
  console.log('');
  return null;
}

/* ── the live check ───────────────────────────────────────────────────── */

const has = (payload: unknown, field: string): string => {
  const record = payload as Record<string, unknown>;
  return field in record ? `PRESENT (${JSON.stringify(record[field])})` : 'ABSENT';
};

async function main(): Promise<number> {
  const creds = credentials();
  if (creds === null) return 0;

  const community = process.argv[2] ?? 'solana';
  const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => Date.now() });

  const client = httpClient({
    ...creds,
    fetch: globalThis.fetch,
    now: () => Date.now(),
    timeoutMs: 15_000,
    onQuota: (reading, endpoint) =>
      console.log(
        `  quota after ${endpoint}: used ${reading.used ?? '?'}, remaining ${reading.remaining ?? '?'}, ` +
          `reset ${reading.resetSeconds ?? '?'}s`,
      ),
  });

  const adapter = redditPlatform({ client, meter, now: () => Date.now() });
  const budget = { capUsd: 1, spentUsd: 0, maxCalls: 10, deadline: Date.now() + 60_000 };

  console.log(`\n── discovering /r/${community}/new ──────────────────────────────────`);
  const found = await adapter.discover(
    { mode: 'feed', term: community, sinceMs: null, untilMs: null, limit: 5, cursor: null },
    budget,
  );
  console.log(`  ${found.value.items.length} items, hasMore=${found.value.hasMore}, cursor=${found.value.cursor}`);
  console.log(`  spend: ${found.spend.units} ${found.spend.unit} at $${found.spend.usd}`);
  console.log(`  documented ceiling (an assumption, not a measurement): ${RATE_LIMIT_PER_MIN}/min`);

  const first = found.value.items[0];
  if (first === undefined) {
    console.log('  the community returned nothing — try another one');
    return 1;
  }

  console.log(`\n── the first item, in our vocabulary ────────────────────────────────`);
  console.log(`  itemId       ${String(first.itemId)}`);
  console.log(`  authorKey    ${String(first.authorKey)}`);
  console.log(`  postedAt     ${first.postedAt} (${first.postedAt === null ? '—' : new Date(first.postedAt).toISOString()})`);
  console.log(`  baselineKey  ${adapter.baselineKey(first, Date.now())}`);
  console.log(`  rawRef       ${first.rawRef}`);
  console.log(`  counters     ${JSON.stringify(first.counters)}`);
  console.log(`  ★ 'reach' in counters === ${'reach' in first.counters}   (must be false)`);
  console.log(`  permalink    ${postUrl('', first.sourceItemId)}`);

  console.log(`\n── ★ the four questions the fixtures cannot answer ──────────────────`);
  const raw = (await client.listing({ path: `/r/${community}/new`, query: { limit: '5' } })).items[0] ?? {};
  console.log(`  num_crossposts    ${has(raw, 'num_crossposts')}  → promote 'reproduction' if PRESENT`);
  console.log(`  upvote_ratio      ${has(raw, 'upvote_ratio')}  (in a LISTING)`);
  console.log(`  author_fullname   ${has(raw, 'author_fullname')}`);
  console.log(`  hide_score        ${has(raw, 'hide_score')} / score ${has(raw, 'score')}`);
  console.log(`  vendor permalink  ${postUrlFromPath(String((raw as Record<string, unknown>).permalink ?? '')) ?? '—'}`);

  console.log(`\n── re-reading the same ids ─────────────────────────────────────────`);
  const ids = found.value.items.map((i) => i.sourceItemId);
  const again = await adapter.observe(ids, budget);
  console.log(`  asked for ${ids.length}, got ${again.value.size} back`);
  console.log(`  ids omitted (removed, deleted or hidden): ${ids.filter((id) => !again.value.has(id)).join(', ') || 'none'}`);
  console.log(`  spend: ${again.spend.units} ${again.spend.unit} at $${again.spend.usd}`);

  console.log(`\n── ★ RECORD THE PAYLOAD ────────────────────────────────────────────`);
  console.log('  Paste this into adapters/platform/reddit/src/__fixtures__/posts.ts,');
  console.log('  replacing the hand-built samples, and delete this script.\n');
  console.log(JSON.stringify(raw, null, 2).slice(0, 4_000));

  console.log(`\n  total metered: $${meter.spentUsd()} — free, and the calls are on the record.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error('\n  the smoke check FAILED against the live API:');
    console.error(`  ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    process.exit(1);
  },
);
