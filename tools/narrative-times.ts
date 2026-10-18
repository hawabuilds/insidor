/**
 * `node --env-file=.env.local --experimental-strip-types tools/narrative-times.ts [--no-match] [--chain] [--out <file.md>]`
 * `node --env-file=.env.local --experimental-strip-types tools/narrative-times.ts --narrative <id or a piece of its title>`
 *
 * THE NARRATIVE TIMES CHECK ON ITS OWN (tools/lib/narrative-times.ts; the 20:00 report runs the same
 * check, tools/name-report.ts section 8): every live narrative's shown "First post", "We found it"
 * and "launched" against what is stored, and the narratives that do not match.
 *
 * Free and read-only by default: stored rows, and the runner's own narratives pass run read-only
 * (`--no-match` skips it). `--chain` reads each page coin's create block time whose stored launch is
 * not the chain's, one RPC call a coin on HELIUS_API_KEY — the runner's chain key, its credits.
 * `--narrative` prints one narrative's backward-search result instead (tools/lib/narrative-back-
 * check.ts): the posts it brought in, and the page's First post and We found it against its posts.
 *
 * What breaks if changed carelessly: nothing is written here, and nothing may be: the check is the
 * owner's view of the pages, not a repair.
 */

import process from 'node:process';
import { writeFileSync } from 'node:fs';

import { chainClient } from '../adapters/venue/solana-pumpfun/src/client.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { narrativeBackLines } from './lib/narrative-back-check.ts';
import { narrativeTimeLines, narrativeTimeRows } from './lib/narrative-times.ts';

const has = (name: string) => process.argv.includes(name);
const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const key = (process.env['HELIUS_API_KEY'] ?? '').trim();
if (has('--chain') && key === '') {
  console.error('--chain needs HELIUS_API_KEY');
  process.exit(2);
}
const chain = has('--chain') ? chainClient({ launchpadBaseUrl: '', rpcUrl: `https://mainnet.helius-rpc.com/?api-key=${key}`, fetch: globalThis.fetch }) : null;
const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-narrative-times' });
try {
  const db = asDb(pool);
  const one = arg('--narrative');
  const lines = one !== null
    ? await narrativeBackLines(db, one)
    : [`# Narrative times, ${new Date().toISOString().slice(0, 16)} UTC`, '', ...narrativeTimeLines(await narrativeTimeRows(db, { match: !has('--no-match'), chain: chain === null ? null : (a) => chain.oldestSignatureBlockTime(a) }))];
  console.log(lines.join('\n'));
  const out = arg('--out');
  if (out !== null) writeFileSync(out, lines.join('\n') + '\n');
} finally {
  await pool.end();
}
