/**
 * `node --env-file=.env.local --experimental-strip-types tools/onecoin-shadow.ts [--hours 24] [--all]`
 *
 * THE SHADOW DAY, SIDE BY SIDE (read-only). For every post the one-coin rule judged in the last
 * `--hours` (internal.post_coin_pick, 0113): the rule's pick — the coin, or waiting / none — with
 * its basis (trades, or market readings while the trade feed was not running) and how many minutes
 * after the picked coin's launch it was decided; what the card showed meanwhile (the live frame or
 * the scroll, tools/lib/feed-cards.ts); and what ran — the owner's call, else the biggest candidate
 * an hour after its launch (tools/lib/onecoin-cases.ts). Then the totals: how often each was right,
 * wrong or showed nothing, against the same truths. Prints the posts whose pick and card disagree,
 * or every post with `--all`.
 *
 * Nothing is written: the session is read-only. Run it before asking the owner to switch
 * Policy.oneCoin.mode to 'live'.
 *
 * What breaks if changed carelessly: a post whose hour has not passed has no truth yet and is
 * counted under "not measured yet", never as wrong for either side.
 */

import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { asDb, createPool, DB_ROLE, missingTable } from '../store/src/index.ts';
import { coinLineOf } from './lib/feed-cards.ts';
import { loadCases, type Truth } from './lib/onecoin-cases.ts';

const P = DEFAULT_POLICY.oneCoin;
const HOUR = 3_600_000;
const MIN = 60_000;
const hours = (() => {
  const i = process.argv.indexOf('--hours');
  const v = i < 0 ? NaN : Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : 24;
})();
const all = process.argv.includes('--all');

type Side = 'right' | 'wrong' | 'nothing' | 'false_pick' | 'quiet';

/** One side's coin against the truth. */
export function judged(shown: string | null, truth: Truth | undefined): Side | null {
  if (truth === undefined) return null;
  if (truth.address === null) return shown === null ? 'quiet' : 'false_pick';
  if (shown === null) return 'nothing';
  return shown === truth.address ? 'right' : 'wrong';
}

async function main(): Promise<void> {
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-onecoin-shadow', max: 1 });
  const client = await pool.connect();
  try {
    await client.query('begin read only');
    const db = asDb(client);
    const now = Date.now();
    const since = now - hours * HOUR;
    const picks = await db.query<{ item_id: string; address: string | null; outcome: string; decided_at: string; evidence: Record<string, unknown>; ticker: string | null; launched_at: string | null }>(
      `select p.item_id, p.address, p.outcome, p.decided_at, p.evidence, n.ticker, coalesce(n.launched_at, a.minted_at) as launched_at
         from internal.post_coin_pick p
         left join public.coin_name n on n.address = p.address
         left join public.asset a on a.address = p.address
        where p.updated_at >= $1 order by p.decided_at`,
      [new Date(since).toISOString()],
    );
    if (picks.length === 0) {
      console.log(`no one-coin picks in the last ${hours}h: is the runner's one-coin loop running, and is 0113 applied?`);
      return;
    }
    const ids = picks.map((p) => p.item_id);
    const cards = await db.query<{ item_id: string; payload: unknown }>(
      `select distinct on (item_id) item_id, payload from (
         select item_id, payload, 0 as o from public.rising_row where item_id = any($1::text[])
         union all select item_id, payload, 1 as o from public.feed_post where item_id = any($1::text[])) x
       order by item_id, o`,
      [ids],
    );
    const cardOf = new Map(cards.map((c) => [c.item_id, coinLineOf(c.payload)] as const));
    const loaded = await loadCases(db, since - P.postWindowMs, now, { truthAtMs: P.refit.truthAtMs, truthMinCapUsd: P.refit.truthMinCapUsd, watchMs: P.watchMs });
    const changes = await db.query<{ subject_id: string; n: number }>(
      `select subject_id, count(*)::int as n from internal.coin_pick_change where subject_kind = 'post' and subject_id = any($1::text[]) group by subject_id`,
      [ids],
    );
    const handovers = new Map(changes.map((c) => [c.subject_id, c.n] as const));

    const tally = { pick: new Map<Side, number>(), card: new Map<Side, number>() };
    const bump = (m: Map<Side, number>, s: Side | null) => s !== null && m.set(s, (m.get(s) ?? 0) + 1);
    let pending = 0;
    let onTrades = 0;
    const lines: string[] = [];
    for (const p of picks) {
      const truth = loaded.truths.get(p.item_id);
      const card = cardOf.get(p.item_id);
      const cardCoin = card?.address ?? null;
      const ps = judged(p.address, truth);
      const cs = judged(cardCoin, truth);
      if (truth === undefined) pending += 1;
      bump(tally.pick, ps);
      bump(tally.card, cs);
      if (p.evidence['basis'] === 'trades') onTrades += 1;
      const after = p.address !== null && p.launched_at !== null ? Math.round((new Date(p.decided_at).getTime() - new Date(p.launched_at).getTime()) / MIN) : null;
      if (all || p.address !== cardCoin) {
        lines.push([
          p.item_id.padEnd(28),
          `pick ${p.outcome === 'picked' ? `$${p.ticker ?? p.address?.slice(0, 6)}${after === null ? '' : ` +${after}m`}` : p.outcome}`.padEnd(26),
          `${String(p.evidence['basis'] ?? '—')}`.padEnd(16),
          `card ${card === undefined ? 'not on a feed' : cardCoin === null ? (card.kind ?? '—') : `$${card.ticker ?? cardCoin.slice(0, 6)}`}`.padEnd(26),
          `ran ${truth === undefined ? 'not measured yet' : truth.address === null ? truth.by : `${truth.address.slice(0, 6)}… (${truth.by})`}`.padEnd(34),
          `${ps ?? ''}/${cs ?? ''}`,
          handovers.has(p.item_id) && (handovers.get(p.item_id) ?? 0) > 1 ? `changes ${handovers.get(p.item_id)}` : '',
        ].join(' '));
      }
    }
    console.log(`one coin, shadow vs what ran — last ${hours}h, mode ${P.mode}: ${picks.length} posts judged (${onTrades} on trades, ${picks.length - onTrades} on market readings), ${pending} not measured yet`);
    console.log('post                         pick                       basis            card                       ran                                pick/card');
    for (const l of lines) console.log(l);
    const row = (label: string, m: Map<Side, number>) =>
      `${label.padEnd(6)} right ${m.get('right') ?? 0}  wrong ${m.get('wrong') ?? 0}  showed nothing ${m.get('nothing') ?? 0}  | nothing ran: picked anyway ${m.get('false_pick') ?? 0}, quiet ${m.get('quiet') ?? 0}`;
    console.log(row('pick', tally.pick));
    console.log(row('card', tally.card));
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    if (missingTable(e)) {
      console.log('0113 is not applied to this database yet: no one-coin candidates or picks to read');
      return;
    }
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
