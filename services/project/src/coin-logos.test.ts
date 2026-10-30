/**
 * The logo mirror's choices, with stand-ins for the database, the sources and storage: the coin's
 * own metadata picture first, then the launchpad's copy, then the market source's; an outage is a
 * failed try, never "none"; a coin left as a letter is logged with why.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_ATTEMPTS, mirrorPass, resolveCoin, shownSetSql, shownSql, type DueCoin, type MirrorDeps } from './coin-logos.ts';

const A = 'So1aNaCoinMint1111111111111111111111111pmp';
const coin = (over: Partial<DueCoin> = {}): DueCoin => ({ address: A, metadataUri: 'https://ipfs.example/ipfs/doc', metadataImage: null, lastOutcome: null, attempts: 0, ...over });
const urls = (link: string) => (link.startsWith('ipfs://') ? ['https://gw1.example/x', 'https://gw2.example/x'] : [link]);

function deps(over: Partial<MirrorDeps> = {}): MirrorDeps & { recorded: unknown[][]; logged: [string, Record<string, unknown>][] } {
  const recorded: unknown[][] = [];
  const logged: [string, Record<string, unknown>][] = [];
  return {
    recorded,
    logged,
    db: {
      query: async (sql: string, params?: readonly unknown[]) => {
        if (sql.includes('insert into internal.coin_logo')) recorded.push([...(params ?? [])]);
        if (sql.includes('information_schema')) return [{ '?column?': 1 }] as never[];
        return [] as never[];
      },
    },
    nowMs: 0,
    elapsedMs: () => 0,
    metadataPicture: async () => 'ipfs://picture',
    venuePicture: async () => 'https://venue.example/p.png',
    marketImages: async () => new Map([[A, 'https://cdn.example/a.png']]),
    pictureUrls: urls,
    copy: async () => {},
    ownCopyUrl: (a) => `https://own.example/coin-logos/${a}`,
    log: (m, f) => logged.push([m, f]),
    ...over,
  };
}

const open = () => true;
const noop = () => {};

test('★ the metadata picture first, through the next gateway when one fails', async () => {
  const tried: string[] = [];
  const r = await resolveCoin(coin(), deps({ copy: async (_a, u) => { tried.push(u); if (u.includes('gw1')) throw new Error('429'); } }), new Map(), open, noop);
  assert.deepEqual(r, { outcome: 'stored', source: 'launch', why: null });
  assert.deepEqual(tried, ['https://gw1.example/x', 'https://gw2.example/x']);
});

test('the picture already read from the metadata is used without reading the document again', async () => {
  let read = 0;
  const r = await resolveCoin(coin({ metadataImage: 'https://pin.example/ipfs/p' }), deps({ metadataPicture: async () => { read += 1; return null; } }), new Map(), open, noop);
  assert.equal(r.outcome, 'stored');
  assert.equal(read, 0);
});

test('★ then the launchpad copy, then the market copy, in that order', async () => {
  const d = deps({ copy: async (_a, u) => { if (!u.includes('cdn.example')) throw new Error('down'); } });
  const r = await resolveCoin(coin(), d, new Map([[A, 'https://cdn.example/a.png']]), open, noop);
  assert.deepEqual(r, { outcome: 'stored', source: 'market', why: null });
  const v = await resolveCoin(coin(), deps({ metadataPicture: async () => null }), new Map(), open, noop);
  assert.deepEqual(v, { outcome: 'stored', source: 'venue', why: null });
});

test('★ every source answering "no picture" is none; any outage makes it failed, with each reason', async () => {
  const none = await resolveCoin(coin({ metadataUri: null }), deps({ venuePicture: async () => null }), new Map(), open, noop);
  assert.equal(none.outcome, 'none');
  assert.match(none.why ?? '', /launch: no metadata link.*venue: no picture.*market: no picture/);

  const out = await resolveCoin(coin(), deps({ metadataPicture: async () => { throw new Error('timeout'); }, venuePicture: async () => null }), null, open, noop);
  assert.equal(out.outcome, 'failed');
  assert.match(out.why ?? '', /launch: metadata unreachable \(timeout\).*market: unreachable/);
});

test('a pass records each coin, and logs a letter when no source has a picture', async () => {
  const d = deps({
    metadataPicture: async () => null,
    venuePicture: async () => null,
    marketImages: async () => new Map(),
    db: {
      query: async (sql: string, params?: readonly unknown[]) => {
        if (sql.includes('information_schema')) return [{ x: 1 }] as never[];
        if (sql.includes('with shown')) return [{ address: A, metadata_uri: 'https://m.example/doc', metadata_image: null, last_outcome: null, attempts: null }] as never[];
        if (sql.includes('insert into internal.coin_logo')) d.recorded.push([...(params ?? [])]);
        return [] as never[];
      },
    },
  });
  const r = await mirrorPass(d);
  assert.equal(r.none, 1);
  assert.equal(r.letters, 1);
  assert.equal(d.recorded[0]?.[1], 'none');
  assert.ok(d.logged.some(([m, f]) => m === 'coin logo is a letter' && f['address'] === A));
});

test('a failed coin is a letter only once it is out of tries', async () => {
  const run = async (attempts: number) => {
    const d = deps({
      copy: async () => { throw new Error('down'); },
      db: {
        query: async (sql: string) => {
          if (sql.includes('information_schema')) return [{ x: 1 }] as never[];
          if (sql.includes('with shown')) return [{ address: A, metadata_uri: null, metadata_image: null, last_outcome: 'failed', attempts }] as never[];
          return [] as never[];
        },
      },
    });
    return (await mirrorPass(d)).letters;
  };
  assert.equal(await run(1), 0);
  assert.equal(await run(MAX_ATTEMPTS - 1), 1);
});

test('★ before migration 0071 the pass waits, touching nothing', async () => {
  const d = deps({ db: { query: async (sql: string) => { if (sql.includes('insert')) throw new Error('wrote'); return [] as never[]; } } });
  assert.equal((await mirrorPass(d)).stored, 0);
  assert.ok(d.logged.some(([m]) => m.includes('0071')));
});

test('the launchpad stops being asked this pass after it fails in a row', async () => {
  let asked = 0;
  let fails = 0;
  let ok = false;
  const isOpen = () => ok || fails < 3;
  const result = (good: boolean) => { if (good) ok = true; else fails += 1; };
  const d = deps({ metadataPicture: async () => null, venuePicture: async () => { asked += 1; throw new Error('blocked'); } });
  for (let i = 0; i < 5; i += 1) await resolveCoin(coin(), d, new Map(), isOpen, result);
  assert.equal(asked, 3);
});

test('★ only coins the app shows are due: no backfill of every coin we hold, and the watchlist only when readable', async () => {
  const withPeople = shownSetSql(true);
  for (const t of ['public.rising_row', 'public.feed_post', 'public.same_name_coin', 'internal.coin_post_link', 'public.story_view', 'public.history_coin', 'people.watch_coin', 'people.alert', 'people.post_watch']) {
    assert.ok(withPeople.includes(t), t);
  }
  assert.ok(!withPeople.includes('public.coin_name'));
  assert.ok(!shownSetSql(false).includes('people.'));
  const asked: string[] = [];
  const d = deps({
    db: {
      query: async (sql: string) => {
        asked.push(sql);
        if (sql.includes('information_schema')) return [{ x: 1 }] as never[];
        if (sql.includes('has_table_privilege')) return [{ ok: false }] as never[];
        return [] as never[];
      },
    },
  });
  await mirrorPass(d);
  const due = asked.find((s) => s.includes('with shown')) ?? '';
  assert.ok(due.includes('public.feed_post') && !due.includes('people.'));
  assert.ok(d.logged.some(([m]) => m.includes('watchlist')));
});

/** A database stand-in: 0071 and 0102 run, one due coin, every statement kept. */
const sizedDb = (row: Record<string, unknown>, asked: [string, readonly unknown[]][]) => ({
  query: async (sql: string, params?: readonly unknown[]) => {
    asked.push([sql, params ?? []]);
    if (sql.includes('information_schema')) return [{ x: 1 }] as never[];
    if (sql.includes('has_table_privilege')) return [{ ok: true }] as never[];
    if (sql.includes('with shown')) return [row] as never[];
    return [] as never[];
  },
});

test('★ an original stored before the two sizes is resized from our own copy, with no host asked', async () => {
  const asked: [string, readonly unknown[]][] = [];
  const copied: string[] = [];
  let hosts = 0;
  const d = deps({
    db: sizedDb({ address: A, metadata_uri: 'https://m.example/doc', metadata_image: null, last_outcome: 'stored', attempts: 1 }, asked),
    metadataPicture: async () => { hosts += 1; return null; },
    marketImages: async () => new Map(),
    copy: async (_a, u) => void copied.push(u),
  });
  const r = await mirrorPass(d);
  assert.equal(r.resized, 1);
  assert.equal(r.stored, 0);
  assert.deepEqual(copied, [`https://own.example/coin-logos/${A}`]);
  assert.equal(hosts, 0);
  assert.ok(asked.some(([s, p]) => s.includes('set sized_at = now()') && p[0] === A));
  assert.ok(!asked.some(([s]) => s.includes('insert into internal.coin_logo')));
  assert.ok((asked.find(([s]) => s.includes('with shown'))?.[0] ?? '').includes('sized_at is null'));
});

test('an original whose copy and sources all fail stays stored, never turned into a failure', async () => {
  const asked: [string, readonly unknown[]][] = [];
  const d = deps({
    db: sizedDb({ address: A, metadata_uri: null, metadata_image: null, last_outcome: 'stored', attempts: 1 }, asked),
    copy: async () => { throw new Error('down'); },
  });
  const r = await mirrorPass(d);
  assert.deepEqual([r.resized, r.stored, r.failed, r.letters], [0, 0, 0, 0]);
  assert.ok(!asked.some(([s]) => s.includes('insert into internal.coin_logo')));
  assert.ok(asked.some(([s]) => s.includes("set checked_at = now() where address = $1 and outcome = 'stored'")));
});

test('a new copy is recorded as the two sizes once 0102 has run', async () => {
  const asked: [string, readonly unknown[]][] = [];
  const d = deps({ db: sizedDb({ address: A, metadata_uri: null, metadata_image: 'https://pin.example/p.png', last_outcome: null, attempts: null }, asked) });
  const r = await mirrorPass(d);
  assert.equal(r.stored, 1);
  assert.ok(asked.some(([s]) => s.includes('insert into internal.coin_logo')));
  assert.ok(asked.some(([s]) => s.includes('set sized_at = now()')));
});

test('★ the pass takes its coins from the ledger before joining the coin and its metadata', () => {
  for (const sql of [shownSql(true, true), shownSql(false, false)]) {
    const limit = sql.indexOf('limit $6');
    assert.ok(limit > 0);
    /* The ledger's order and the limit sit inside `due`; the coin and metadata joins only after it. */
    assert.ok(sql.indexOf('internal.coin_logo') < limit);
    assert.ok(sql.indexOf('public.asset a') > limit);
    assert.ok(sql.indexOf('internal.coin_metadata m') > limit);
    /* The same order inside and out, so the 180 come back in the order they were chosen. */
    assert.match(sql, /order by l\.outcome = 'stored' nulls first, l\.checked_at asc nulls first\s+limit \$6/);
    assert.match(sql, /order by d\.last_outcome = 'stored' nulls first, d\.checked_at asc nulls first$/);
  }
});
