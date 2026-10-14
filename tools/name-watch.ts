/**
 * `node --env-file=.env.local --experimental-strip-types tools/name-watch.ts [baseline | run | list]`
 *
 * THE NAMER'S FIRST DAY, WATCHED (the owner, 2026-10-14: "list every coin it adds to a post that
 * had none before; flag any I mark Wrong coin or No coin; if wrong coins go up vs before, switch it
 * off and tell me"). Runs on Railway with the projector's schedule (tools/railway-start.mjs, every
 * ten minutes), so it does not depend on anyone's session. Free: database reads and writes only.
 *
 *   baseline   every feed card's coin now (tools/lib/feed-cards.ts) as the starting state. Taken
 *              BEFORE the namer is switched on; refused when one exists (pass --again to retake).
 *   run        (the job) each card's coin against the last reading: a coin shown where the card
 *              showed none — or showed another — is an addition (internal.name_watch_addition),
 *              marked `by_guess` when it is one of the namer's guesses for the post (core
 *              `guessIsCoin`). The owner's later call on each addition is read (right / wrong / none).
 *              Within Policy.names.watch.hours of the baseline: once at least `minWrong` of the
 *              namer's additions are called wrong or no coin and their wrong share is above the owner's
 *              wrong share on shown coins in the same hours before the baseline, the namer is vetoed
 *              (0077 internal.name_switch), its guesses are cleared so no reader uses them, and the
 *              owner is sent a push (`namer_off`). Every run is a row in internal.name_watch_run.
 *              With no baseline yet, the first run takes it (and says so).
 *   list       the additions so far, with the owner's calls: the owner's list.
 *
 * Before 0077 it says so and exits 0: the projector's schedule must not fail on it.
 *
 * What breaks if changed carelessly: the baseline's timing. Taken after the namer is on, every coin
 * it already added looks as if it was always there, and the watch sees nothing to judge.
 */

import process from 'node:process';

import { DEFAULT_POLICY as P } from '../contracts/src/policy.ts';
import { guessIsCoin } from '../core/src/create/name-guess.ts';
import { asDb, createPool, DB_ROLE, PgNameGuessRepo, PgOwnerAlertRepo, type Db } from '../store/src/index.ts';
import { feedCards, type FeedCard } from './lib/feed-cards.ts';

const command = process.argv[2] ?? 'run';
const HOUR_MS = 3_600_000;

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-name-watch' });
const db = asDb(pool);
const log = (level: string, msg: string, f: Record<string, unknown> = {}) => console.log(JSON.stringify({ level, msg, job: 'name-watch', ...f }));

async function migrated(): Promise<boolean> {
  const r = await db.query<{ ok: boolean }>(`select to_regclass('internal.name_watch_state') is not null as ok`);
  return r[0]?.ok === true;
}

async function writeState(cards: readonly FeedCard[]): Promise<void> {
  if (cards.length === 0) return;
  await db.query(
    `insert into internal.name_watch_state (item_id, address, name, ticker, kind, claim_count, observed_at)
     select * , now() from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[])
     on conflict (item_id) do update set address = excluded.address, name = excluded.name, ticker = excluded.ticker,
       kind = excluded.kind, claim_count = excluded.claim_count, observed_at = now()`,
    [cards.map((c) => c.itemId), cards.map((c) => c.address), cards.map((c) => c.name), cards.map((c) => c.ticker), cards.map((c) => c.kind), cards.map((c) => c.claimCount)],
  );
}

async function baselineAt(d: Db): Promise<number | null> {
  const r = await d.query<{ at: Date | null }>('select max(at) as at from internal.name_watch_run where baseline');
  return r[0]?.at === null || r[0]?.at === undefined ? null : new Date(r[0].at).getTime();
}

async function takeBaseline(): Promise<void> {
  const cards = await feedCards(db);
  await db.query('delete from internal.name_watch_state');
  await writeState(cards);
  await db.query(`insert into internal.name_watch_run (baseline, cards, additions, by_guess, labelled, wrong, note) values (true, $1, 0, 0, 0, 0, 'baseline')`, [cards.length]);
  log('info', 'baseline taken', { cards: cards.length, showingCoin: cards.filter((c) => c.address !== null).length });
}

/** The owner's newest call on each addition made after it: right (this coin), wrong, or none. */
async function readVerdicts(): Promise<void> {
  await db.query(
    `update internal.name_watch_addition a set verdict = v.verdict, verdict_at = v.created_at
       from (
         select distinct on (a2.id) a2.id,
                case when f.verdict = 'none' then 'none'
                     when f.verdict = 'right' and f.coin_address = a2.address then 'right'
                     when f.verdict = 'wrong' and f.coin_address is null and coalesce(split_part(f.shown->>'coinId', ':', 2), a2.address) = a2.address then 'wrong'
                     when f.verdict in ('right', 'wrong') and f.coin_address is not null and f.coin_address <> a2.address then 'wrong'
                     else null end as verdict,
                f.created_at
           from internal.name_watch_addition a2
           join internal.owner_feedback f on f.subject_kind = 'coin_match' and f.item_id = a2.item_id and f.created_at >= a2.added_at
          where f.verdict in ('right', 'wrong', 'none')
          order by a2.id, f.created_at desc, f.id desc) v
      where v.id = a.id and v.verdict is not null and a.verdict is distinct from v.verdict`,
  );
}

/** The owner's wrong share on coins cards showed, in the window before the baseline: wrong or no coin, or another coin picked. */
async function rateBefore(base: number, hours: number): Promise<number | null> {
  const r = await db.query<{ all_: string; wrong: string }>(
    `select count(*)::text as all_,
            count(*) filter (where f.verdict in ('wrong', 'none') or (f.verdict = 'right' and f.coin_address is distinct from split_part(f.shown->>'coinId', ':', 2)))::text as wrong
       from internal.owner_feedback f
      where f.subject_kind = 'coin_match' and f.shown->>'coinId' is not null
        and f.created_at >= to_timestamp($1 / 1000.0) - make_interval(hours => $2) and f.created_at < to_timestamp($1 / 1000.0)`,
    [base, hours],
  );
  const all = Number(r[0]?.all_ ?? 0);
  return all === 0 ? null : Number(r[0]?.wrong ?? 0) / all;
}

async function run(): Promise<void> {
  const base = await baselineAt(db);
  if (base === null) {
    log('warn', 'no baseline yet: taking it now; coins the namer already added are not seen as additions');
    await takeBaseline();
    return;
  }
  const w = P.names.watch;
  const within = Date.now() - base < w.hours * HOUR_MS;
  const cards = await feedCards(db);
  const prev = new Map((await db.query<{ item_id: string; address: string | null }>('select item_id, address from internal.name_watch_state')).map((r) => [r.item_id, r.address] as const));
  const ids = cards.map((c) => c.itemId);
  const guessRows = await db.query<{ item_id: string; name: string; ticker: string }>('select item_id, name, ticker from internal.name_guess where item_id = any($1::text[]) order by item_id, rank', [ids]);
  const guesses = new Map<string, { name: string; ticker: string }[]>();
  for (const g of guessRows) guesses.set(g.item_id, [...(guesses.get(g.item_id) ?? []), { name: g.name, ticker: g.ticker }]);

  let added = 0;
  let byGuessAdded = 0;
  for (const c of cards) {
    if (c.address === null) continue;
    const had = prev.get(c.itemId);
    const g = guesses.get(c.itemId) ?? [];
    const byGuess = g.some((x) => guessIsCoin(x, { name: c.name ?? '', ticker: c.ticker ?? '' }, P.names));
    /* Shown where it showed none or another; a card new to the watch counts only when the namer's names found its coin. */
    const isAddition = had === undefined ? byGuess : had !== c.address;
    if (!isAddition) continue;
    const r = await db.query<{ id: string }>(
      `insert into internal.name_watch_addition (item_id, address, prev_address, name, ticker, by_guess, guesses, excerpt)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) on conflict (item_id, address) do nothing returning id`,
      [c.itemId, c.address, had ?? null, c.name, c.ticker, byGuess, JSON.stringify(g), c.excerpt],
    );
    if (r.length > 0) {
      added += 1;
      if (byGuess) byGuessAdded += 1;
      log('info', 'coin added to a feed post', { item: c.itemId, coin: c.ticker, address: c.address, before: had ?? 'not watched', byGuess });
    }
  }
  await writeState(cards);
  await readVerdicts();

  const t = await db.query<{ labelled: string; wrong: string; flagged: string }>(
    `select count(*) filter (where verdict is not null)::text as labelled, count(*) filter (where verdict in ('wrong', 'none'))::text as wrong,
            coalesce(string_agg(item_id || ' ' || coalesce(ticker, address) || ' ' || verdict, '; ') filter (where verdict in ('wrong', 'none')), '') as flagged
       from internal.name_watch_addition where by_guess and added_at >= to_timestamp($1 / 1000.0)`,
    [base],
  );
  const labelled = Number(t[0]?.labelled ?? 0);
  const wrong = Number(t[0]?.wrong ?? 0);
  const after = labelled === 0 ? null : wrong / labelled;
  const before = await rateBefore(base, w.hours);
  const guessesRepo = new PgNameGuessRepo(db);
  const alreadyOff = await guessesRepo.switchedOff();
  const goesUp = after !== null && wrong >= w.minWrong && after > (before ?? 0);
  let switched = false;
  let note = within ? 'watching' : 'watch over: recorded only';
  if (t[0]?.flagged) log('warn', 'the owner called coins the namer found wrong or no coin', { flagged: t[0].flagged });
  if (within && goesUp && !alreadyOff && P.names.on) {
    const why = `watch ${new Date().toISOString()}: owner called ${wrong} of ${labelled} coins the namer found wrong or no coin (${Math.round((after ?? 0) * 100)}%), against ${before === null ? 'no calls' : `${Math.round(before * 100)}%`} on shown coins before`;
    await guessesRepo.setSwitch(false, why);
    await db.query('delete from internal.name_guess');
    switched = true;
    note = why;
    log('error', 'the namer is switched off', { why });
    try {
      const alerts = new PgOwnerAlertRepo(db);
      for (const userId of await alerts.ownerIds(P.owner.wallets)) {
        await alerts.queue(userId, { kind: 'namer_off', subject: `namer_off|${new Date(base).toISOString()}`, rung: 1, facts: { wrong, labelled, rateBefore: before }, href: '/#/alerts' });
      }
    } catch (e) {
      log('error', 'the push could not be queued; the namer is off all the same', { err: e instanceof Error ? e.message : String(e) });
    }
  }
  await db.query(
    `insert into internal.name_watch_run (cards, additions, by_guess, labelled, wrong, rate_after, rate_before, switched_off, note) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [cards.length, added, byGuessAdded, labelled, wrong, after, before, switched, note],
  );
  log('info', 'watch ran', { cards: cards.length, added, byGuessAdded, labelled, wrong, rateAfter: after, rateBefore: before, switched, alreadyOff, within });
}

async function list(): Promise<void> {
  const rows = await db.query<{ added_at: Date; item_id: string; ticker: string | null; name: string | null; prev_address: string | null; by_guess: boolean; verdict: string | null; excerpt: string | null }>(
    'select added_at, item_id, ticker, name, prev_address, by_guess, verdict, excerpt from internal.name_watch_addition order by added_at',
  );
  for (const r of rows) {
    console.log(`${new Date(r.added_at).toISOString().slice(0, 16)}  ${r.item_id}  ${r.name ?? ''} $${r.ticker ?? ''}${r.prev_address === null ? '' : ` (replaced ${r.prev_address.slice(0, 6)}…)`}  ${r.by_guess ? 'namer' : 'other'}  ${r.verdict ?? '—'}  "${(r.excerpt ?? '').slice(0, 70)}"`);
  }
  console.log(`${rows.length} additions; ${rows.filter((r) => r.by_guess).length} by the namer's names; ${rows.filter((r) => r.verdict === 'wrong' || r.verdict === 'none').length} called wrong or no coin`);
}

try {
  if (!(await migrated())) log('info', '0077 is not applied: nothing watched');
  else if (command === 'baseline') {
    if ((await baselineAt(db)) !== null && !process.argv.includes('--again')) {
      console.error('a baseline exists; pass --again to retake it (only before the namer is switched on).');
      process.exitCode = 2;
    } else await takeBaseline();
  } else if (command === 'list') await list();
  else await run();
} finally {
  await pool.end();
}
