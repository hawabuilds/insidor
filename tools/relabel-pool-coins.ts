/**
 * `node --env-file=.env.local --experimental-strip-types tools/relabel-pool-coins.ts [--yes] [--max-calls <n>] [--days <n>]`
 *
 * RELABEL THE COINS FILED AS LAUNCHPAD COINS THAT NEVER HAD A LAUNCHPAD CURVE. Until 9 Nov 2026 a
 * coin found by name search and trading only in the launchpad's graduated pool was stored under the
 * launchpad's venue (adapters/venue/solana-pumpfun search-asset.ts), though anyone can open such a
 * pool for a coin made elsewhere — the scam coins whose pool is later pulled (the owner, 9 Nov:
 * JENSEN on the Tape). The search path now asks the chain first; this repairs what it already wrote.
 *
 * WHAT IT DOES: takes, held picks first, the search-found rows (`backfill`) under the launchpad's venue that something
 * shows — a held or recent pick, a candidate of the last `--days` (default 14), or an owner coin call —
 * asks the chain whether each has a launchpad curve (one batched read per 100 coins, the same read the
 * trade feed makes), and relabels the ones with none to the pool's venue (`solana:pumpswap`). Every
 * gate reads the venue — the Tape (read running-coins.ts), the pushes (notify coin-gate.ts), the coin
 * match (store one-coin.ts and the runner's launchpad sweep) — so a relabelled coin leaves all three
 * within one runner pass and the store's ten-minute hold.
 *
 * ★ HARD CAP ON CHAIN CALLS (29 Oct: an uncapped bulk read exhausted the live keys). At most
 * `--max-calls` reads (default 30 = 3,000 coins), on HELIUS_RESEARCH_KEY when set, else
 * HELIUS_API_KEY. A coin the chain could not answer for is left as it is — unknown is never "no curve".
 *
 * DRY RUN BY DEFAULT: read only, the plan printed. `--yes` writes the relabel in one transaction.
 *
 * What breaks if changed carelessly: the origin filter. A `live_stream` row was written from the
 * launchpad's own create event and is a launchpad coin by definition; only search-found rows are asked.
 */

import { writeFile } from 'node:fs/promises';
import process from 'node:process';

import { curvePlaces } from '../adapters/venue/solana-pumpfun/src/curve-rpc.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';

const LAUNCHPAD_VENUE = 'solana:pumpfun';
const POOL_VENUE = 'solana:pumpswap';
const PER_CALL = 100;
/* The research key answered 429 to calls sent back to back (9 Nov): one call every half second. */
const PACE_MS = 500;

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const write = process.argv.includes('--yes');
const maxCalls = Math.max(1, Math.min(300, Number(arg('--max-calls', '30'))));
const days = Math.max(1, Number(arg('--days', '14')));
const key = process.env['HELIUS_RESEARCH_KEY'] || process.env['HELIUS_API_KEY'];
if (key === undefined || key === '') throw new Error('HELIUS_RESEARCH_KEY or HELIUS_API_KEY is needed to read the chain');
const rpc = { rpcUrl: `https://mainnet.helius-rpc.com/?api-key=${key}`, fetch: globalThis.fetch, timeoutMs: 20_000 };

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-relabel-pool-coins' });
const client = await pool.connect();
const db = asDb(client);
try {
  await client.query(write ? 'begin' : 'begin read only');
  const rows = await db.query<{ address: string; symbol: string | null; picked: boolean; tape: boolean }>(
    `with shown as (
       select address from internal.post_coin_pick where outcome = 'picked' and address is not null
       union select address from internal.narrative_coin_pick where outcome = 'picked' and address is not null
       union select coin_address from internal.owner_feedback where subject_kind = 'coin_match' and coin_address is not null
       union select address from internal.one_coin_candidate where found_at >= now() - make_interval(days => $2)
     )
     select a.address, a.symbol,
            exists (select 1 from internal.post_coin_pick p where p.address = a.address and p.outcome = 'picked')
              or exists (select 1 from internal.narrative_coin_pick n where n.address = a.address and n.outcome = 'picked') as picked,
            exists (select 1 from public.tape_coin t where t.coin->>'address' = a.address) as tape
       from public.asset a join shown s on s.address = a.address
      where a.chain = 'solana' and a.venue_id = $1 and a.origin = 'backfill'
      order by 3 desc, a.first_seen_at desc`,
    [LAUNCHPAD_VENUE, days],
  );
  const asked = rows.slice(0, maxCalls * PER_CALL);
  console.log(`search-found launchpad rows something shows: ${rows.length}; asking the chain about ${asked.length} (${Math.ceil(asked.length / PER_CALL)} calls, cap ${maxCalls})`);
  const places = new Map<string, string>();
  let calls = 0;
  for (let i = 0; i < asked.length; i += PER_CALL) {
    if (i > 0) await new Promise((r) => setTimeout(r, PACE_MS));
    const batch = asked.slice(i, i + PER_CALL).map((r) => r.address);
    try {
      const r = await curvePlaces(rpc, batch);
      calls += r.calls;
      for (const [a, p] of r.places) places.set(a, p);
    } catch (e) {
      console.log(`chain read failed for a batch of ${batch.length}; left as they are: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const none = asked.filter((r) => places.get(r.address) === 'no_curve');
  const count = (p: string) => asked.filter((r) => places.get(r.address) === p).length;
  console.log(`chain calls: ${calls}. on the curve ${count('curve')}, graduated ${count('graduated')}, NO CURVE ${none.length}, unanswered ${asked.length - places.size}`);
  console.log(`no curve and held as a pick: ${none.filter((r) => r.picked).length}; on the Tape now: ${none.filter((r) => r.tape).length}`);
  for (const r of none.slice(0, 40)) console.log(`  ${r.address}  ${r.symbol ?? '-'}${r.picked ? '  [picked]' : ''}${r.tape ? '  [tape]' : ''}`);
  if (write && none.length > 0) {
    const done = await db.query<{ address: string }>(
      `update public.asset set venue_id = $2 where chain = 'solana' and venue_id = $1 and origin = 'backfill' and address = any($3::text[]) returning address`,
      [LAUNCHPAD_VENUE, POOL_VENUE, none.map((r) => r.address)],
    );
    await client.query('commit');
    /* Every relabelled address, so the change can be undone exactly (set venue_id back for these). */
    const file = `reports/relabel-pool-coins-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.txt`;
    await writeFile(file, done.map((r) => r.address).join('\n') + '\n');
    console.log(`relabelled ${done.length} to ${POOL_VENUE}; addresses in ${file}`);
  } else {
    await client.query('rollback');
    console.log(write ? 'nothing to relabel' : 'dry run: nothing written (pass --yes to relabel)');
  }
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  throw e;
} finally {
  client.release();
  await pool.end();
}
