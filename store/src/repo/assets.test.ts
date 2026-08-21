/**
 * The coverage claim is monotone, and this file exists to keep it that way.
 *
 * `recordCoverage` is the single write path for BOTH kinds of claim a coverage
 * row can make — "we watched this window" and "we could not see this window" —
 * so the two collide on one primary key, `(chain, window_from)`. That collision
 * is not a corner: a live run against the real relay produced it on the first
 * cycle after a restart, because the "stream was not connected" gap and the "no
 * successful read for Nms" gap both begin at the resume watermark.
 *
 * These tests are about the ON CONFLICT clause and nothing else, so they run
 * against a fake `Db` that records the statement rather than a live Postgres —
 * the same posture as the rest of this package, which never asks a test runner
 * for a database. The behavioural proof that the clause does what the words say
 * was taken separately, against the real schema, both orderings.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { chainId, OBSERVED_ASSET_ORIGINS } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { PgAssetRepo } from './assets.ts';

/** Captures the statement rather than running it. */
function recorder(): { db: Db; sql: () => string } {
  let last = '';
  return {
    db: {
      query: async <R>(sql: string): Promise<R[]> => {
        last = sql;
        return [];
      },
    },
    sql: () => last,
  };
}

async function coverageSql(): Promise<string> {
  const { db, sql } = recorder();
  const repo = new PgAssetRepo(db);
  await repo.recordCoverage(chainId('solana'), 0 as Millis, 1000 as Millis, null, {
    reason: 'stream_disconnect: socket error',
  });
  return sql().replace(/\s+/g, ' ');
}

/*
 * The regression itself. `gap` was absent from the SET list, and absent is not
 * neutral: the existing row kept the claim while the incoming row still won
 * `window_to`, so a gap landing on an observed window left `gap = false` and
 * stretched that false row across the dark interval. A row that asserts we
 * watched exactly the seconds we missed is worse than a dropped write, because
 * nothing downstream can discover it is wrong.
 */
test('a window ever declared dark stays dark, whichever write lands second', async () => {
  const sql = await coverageSql();
  assert.match(
    sql,
    /gap\s*=\s*internal\.mint_coverage\.gap\s+or\s+excluded\.gap/,
    'the gap claim must be OR-ed, never assigned: assigning lets a later observation ' +
      'promote a window we know was dark back to watched',
  );
});

test('the reason survives, so a censored label can say why it was censored', async () => {
  const sql = await coverageSql();
  assert.match(sql, /gap_reason\s*=\s*coalesce\(excluded\.gap_reason,/);
});

/*
 * A gap write carries no position, and it used to null out the position on any
 * row it merged into — losing the resume diagnostic from a row that had one.
 */
test('a write with no position to offer does not erase the one already there', async () => {
  const sql = await coverageSql();
  assert.match(sql, /cursor_ref\s*=\s*coalesce\(excluded\.cursor_ref,/);
});

/*
 * Widening is the only safe direction for the interval too. Shrinking `window_to`
 * would silently un-declare time a previous write had already claimed.
 */
test('the window only ever widens', async () => {
  const sql = await coverageSql();
  assert.match(sql, /window_to\s*=\s*greatest\(internal\.mint_coverage\.window_to,/);
});

/* ── ★ provenance and freshness ───────────────────────────────────────── */

/** Captures the statement AND what was bound to it. */
function paramRecorder(): { db: Db; last: () => { sql: string; params: readonly unknown[] } } {
  let sql = '';
  let params: readonly unknown[] = [];
  return {
    db: {
      query: async <R>(s: string, p?: readonly unknown[]): Promise<R[]> => {
        sql = s;
        params = p ?? [];
        return [];
      },
    },
    last: () => ({ sql: sql.replace(/\s+/g, ' '), params }),
  };
}

test('★ an OBSERVED story retrieves only origins that are a claim about the world', async () => {
  /* The furthest a fiction can travel in this system. Whatever `mintedBetween` returns is
     what resolve scores, and a coin that wins becomes a LABEL — an append-only training
     example about a coin that never existed, attached to a real story, with nothing
     anywhere recording that it was invented. Every other consequence of the provenance bug
     is a screen; this one is the corpus.

     This is the half of the rule that must never loosen, and it is asserted against the
     story origin that carries the danger rather than against the method in general. */
  const { db, last } = paramRecorder();
  await new PgAssetRepo(db).mintedBetween(
    chainId('solana'),
    0 as Millis,
    1000 as Millis,
    10,
    'observed',
  );
  const { sql, params } = last();

  assert.match(sql, /and origin = any\(\$\d+::text\[\]\)/);
  const bound = params.find((p) => Array.isArray(p)) as string[] | undefined;
  assert.notEqual(bound, undefined, 'the origin list was not bound to the statement');
  assert.deepEqual([...(bound ?? [])].sort(), [...OBSERVED_ASSET_ORIGINS].sort());
  assert.equal((bound ?? []).includes('fixture'), false);
});

test('★ a FIXTURE story retrieves the fixtures it exists to demonstrate', async () => {
  /* THE OTHER DIRECTION, AND IT IS A TEST RATHER THAN AN OMISSION BECAUSE THE BUG IT GUARDS
     WAS SHIPPED. When this method carried a module constant it answered "is this coin
     observed" for every caller, which is a question about ONE subject — and retrieval has
     two. Measured through this method before the correction: every seeded story reached the
     gates with 43 candidates where its window held 51–54, and one reached them with 0 where
     its window held 2, which the runner wrote into an append-only decision log as
     `V3_no_candidates`.

     `none` is the dangerous direction. On the board it is the branch that offers CREATE for
     a story that already has three coins; here it is a false negative frozen into the table
     every later recall number is computed over. A stricter filter that cannot see its second
     subject is not stricter, it is answering a different question.

     The asymmetry is the rule: a demonstration that names a demonstration coin is still a
     demonstration, and the row is labelled one everywhere it is shown. */
  const { db, last } = paramRecorder();
  await new PgAssetRepo(db).mintedBetween(
    chainId('solana'),
    0 as Millis,
    1000 as Millis,
    10,
    'fixture',
  );
  const { params } = last();

  const bound = params.find((p) => Array.isArray(p)) as string[] | undefined;
  assert.notEqual(bound, undefined, 'the origin list was not bound to the statement');
  assert.equal(
    (bound ?? []).includes('fixture'),
    true,
    '★ a seeded story cannot see its own seeded coins, which is the CREATE-on-a-minted-story bug',
  );
  /* ★ AN EXACT LIST, NOT A CONTAINMENT CHECK, and the exactness is what makes this the
     whole rule rather than half of it. It says three things at once: the observed origins
     all survive (a fixture story may match a real coin, and losing that would be this same
     bug pointed the other way), 'fixture' is added, and NOTHING ELSE IS. That last clause
     is how the widest origin any story can be granted stays a closed set — an origin
     meaning "we cannot place this row" is visible to nobody, fixture stories included,
     because it is not a kind of row but an admission that we cannot vouch for one.

     Spelled as a derivation of OBSERVED_ASSET_ORIGINS rather than as a literal list, so a
     sixth origin added to contracts next year does not quietly satisfy this assertion. */
  assert.deepEqual([...(bound ?? [])].sort(), [...OBSERVED_ASSET_ORIGINS, 'fixture'].sort());
});

test("★ an origin only ever moves TOWARDS a claim about the world, never away from one", async () => {
  /* The third rule in this file that may travel in one direction only — mint time rises in
     confidence, a coverage window moves towards darkness, and this moves towards being
     observed. The transition that must be impossible is a seed re-running over a coin the
     socket has already delivered and relabelling it a fixture, which would take a real coin
     off every surface, silently, leaving no evidence it had ever been there.

     The allowed direction is the other one: a row we could not vouch for becomes an
     observation the moment a transport actually delivers it. */
  const { db, last } = paramRecorder();
  await new PgAssetRepo(db).upsert([
    {
      ref: { chain: chainId('solana'), address: 'a' },
      key: 'solana:a',
      chain: chainId('solana'),
      venue: 'solana:pumpfun',
      origin: 'live_stream',
      mintedAt: { at: 1 as Millis, source: 'vendor_field', confidence: 'bounded', boundS: 5 },
      symbol: null,
      name: null,
      imageUri: null,
      decimals: null,
      creator: null,
      declaredSocial: {},
      firstSeenAt: 2 as Millis,
    },
  ] as never);
  const { sql } = last();

  /* The incoming origin wins ONLY when it is observed and the stored one is not. Spelled
     with the allowlist alone, so no value outside contracts is named in SQL. */
  assert.match(
    sql,
    /origin = case when excluded\.origin = any\(\$\d+::text\[\]\) and public\.asset\.origin <> all\(\$\d+::text\[\]\) then excluded\.origin else public\.asset\.origin end/,
    'the origin update must be one-way, and must be expressed with the allowlist',
  );
  /* Not a plain assignment. `origin = excluded.origin` would let a seed overwrite an
     observation, which is the whole bug with a new mechanism. */
  assert.equal(
    /origin = excluded\.origin,/.test(sql),
    false,
    'origin must never be assigned unconditionally',
  );
});

test('★ "when did we last hear anything" excludes gap rows, and that is the whole point', async () => {
  /* The trap this method exists to avoid. `latestCoverage` above orders across ALL rows
     including gaps, and it is right to — its question is "where do I resume", and a gap row
     is still a record of where we got to. But a gap row's `window_to` ADVANCES WHILE NOTHING
     WAS HEARD, so a watcher that reconnects and immediately declares six dark days would
     push that answer to `now`. A freshness signal built on it would announce the feed live
     over exactly the interval we had just declared dark — a lie precisely when it matters,
     on the one surface built to prevent it.

     Two questions, two reads. This store already holds nine gap rows beside 133 observed
     ones, so the divergence is not hypothetical. */
  const { db, last } = paramRecorder();
  await new PgAssetRepo(db).lastHeardAt(chainId('solana'));
  const { sql } = last();

  assert.match(sql, /select max\(window_to\) as last_heard_at from internal\.mint_coverage/);
  assert.match(sql, /and not gap/, 'a gap row must not count as having heard anything');
  /* And it is `max(window_to)`, not `order by … limit 1`: the latter would return the newest
     ROW's end, and after the OR-ing upsert the newest row is not always the furthest one. */
  assert.equal(/order by/.test(sql), false);
});

test('a chain nobody has ever watched answers null, not an instant of zero', async () => {
  /* `max()` over no rows is one row holding null, and "the table was not reached" would be
     zero rows. Both are the same answer to this question — nothing has ever been heard —
     and an epoch-zero instant would render as 1970 and read as very, very stale rather than
     as never. */
  const empty: Db = { query: async <R>(): Promise<R[]> => [] };
  assert.equal(await new PgAssetRepo(empty).lastHeardAt(chainId('solana')), null);

  const nullColumn: Db = { query: async <R>(): Promise<R[]> => [{ last_heard_at: null } as R] };
  assert.equal(await new PgAssetRepo(nullColumn).lastHeardAt(chainId('solana')), null);
});

test('★ the chain list is the chains we have OBSERVED, because the rail reads it', async () => {
  /* The read of this table where provenance looks like it cannot matter — it returns chain
     names, not coins — and does, because of what the launches projector does with the answer.
     It asks `lastHeardAt` for every chain this returns and takes the MINIMUM, so one chain
     nobody has ever heard a mint on collapses the rail's freshness fact to "nothing has ever
     been heard on this feed".

     A seed writing one fixture on a second chain would therefore hang a permanent "no coin
     mint has ever been heard" banner over a rail whose real feed was streaming — a fiction
     changing what a live surface says about the world, through a column this statement does
     not even select. It fails in the safe direction, which is why it survived a review; that
     is not a reason for an unfiltered read of this table to exist. */
  const { db, last } = paramRecorder();
  await new PgAssetRepo(db).chains();
  const { sql, params } = last();

  assert.match(sql, /where origin = any\(\$\d+::text\[\]\)/);
  const bound = params.find((p) => Array.isArray(p)) as string[] | undefined;
  assert.deepEqual([...(bound ?? [])].sort(), [...OBSERVED_ASSET_ORIGINS].sort());
  assert.equal((bound ?? []).includes('fixture'), false, '★ a seeded chain would reach the rail');
  /* Still ordered, so a caller looping over it does the same work in the same order twice. */
  assert.match(sql, /order by chain/);
});
