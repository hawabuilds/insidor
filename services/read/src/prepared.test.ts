/**
 * The kept replies (prepared.ts), with a fake clock, a fake tick table and a counting builder:
 * what a request is answered from, when a reply is rebuilt, and what is never kept.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SILENT } from './log.ts';
import { createPrepared, ruleFor, TICKS_SQL, type PlainReply } from './prepared.ts';

function rig(answer: (url: string, n: number) => PlainReply = (url, n) => ({ status: 200, body: JSON.stringify({ url, n }) })) {
  let clock = 1_000_000;
  let fyp = '7';
  let builds = 0;
  let tickReads = 0;
  const prepared = createPrepared({
    log: SILENT,
    now: () => clock,
    db: {
      query: async (sql) => {
        assert.equal(sql, TICKS_SQL);
        tickReads += 1;
        return [{ k: 'rising:fyp', tick: fyp }, { k: 'board:default', tick: '3' }];
      },
    },
    build: async (url) => {
      builds += 1;
      await new Promise((r) => setTimeout(r, 5));
      return answer(url, builds);
    },
  });
  const settle = () => new Promise((r) => setTimeout(r, 30));
  return {
    prepared,
    settle,
    builds: () => builds,
    tickReads: () => tickReads,
    advance: (ms: number) => (clock += ms),
    moveFyp: (t: string) => (fyp = t),
    read: async (url: string) => JSON.parse(((await prepared.serve(url)) ?? assert.fail('not kept')).body.toString()) as { n: number },
  };
}

test('only the shared reads are kept: never search, a wallet, the stream, or a per-client list', () => {
  for (const url of ['/rising/fyp', '/rising/fyp/tick', '/rising/fyp/sorted?by=trending', '/board/default', '/narratives/default', '/narratives/default/all?sort=new&offset=0', '/story/n-1', '/story/n-1/sheet', '/post/x:1/sheet', '/coin/solana:abc', '/coin/solana:abc/market?tf=1m', '/coin/solana:abc/about']) {
    assert.notEqual(ruleFor(url), null, url);
  }
  for (const url of ['/search?q=cat', '/wallet/abc', '/wallet/abc/history', '/ticker/CAT', '/post/x:1/coins', '/post/x:1/names', '/stream/board/default', '/health', '/rising/fyp/older?before=1', `/story/${'x'.repeat(500)}`]) {
    assert.equal(ruleFor(url), null, url);
  }
  assert.equal(ruleFor('/rising/fyp')?.tick, 'rising:fyp');
  assert.equal(ruleFor('/narratives/default/all?sort=new')?.tick, 'board:default');
  assert.equal(ruleFor('/coin/solana:abc/market?tf=1m')?.tick, null);
});

test('requests asked at once share one build, and the next request is answered from memory', async () => {
  const r = rig();
  const [a, b, c] = await Promise.all([r.read('/rising/fyp'), r.read('/rising/fyp'), r.read('/rising/fyp')]);
  assert.equal(r.builds(), 1);
  assert.deepEqual([a.n, b.n, c.n], [1, 1, 1]);
  assert.equal((await r.read('/rising/fyp')).n, 1);
  assert.equal(r.builds(), 1);
});

test('★ a frame that moved is rebuilt behind the reply; the request is never made to wait for it', async () => {
  const r = rig();
  await r.read('/rising/fyp');
  r.moveFyp('8');
  r.advance(1_000);
  r.prepared.changed();
  await r.settle();
  assert.equal(r.builds(), 2, 'the watcher saw tick 8 and rebuilt');
  assert.equal((await r.read('/rising/fyp')).n, 2);
  /* Nothing moved: the watcher reads the ticks and builds nothing. */
  r.advance(2_000);
  r.prepared.changed();
  await r.settle();
  assert.equal(r.builds(), 2);
});

test('a reply past refreshMs is served once more and rebuilt behind it; past keepMs the request waits', async () => {
  const r = rig();
  await r.read('/coin/solana:abc/market?tf=1m');
  r.advance(5_000);
  assert.equal((await r.read('/coin/solana:abc/market?tf=1m')).n, 1, 'stale-while-revalidate');
  await r.settle();
  assert.equal((await r.read('/coin/solana:abc/market?tf=1m')).n, 2);
  r.advance(60_000);
  assert.equal((await r.read('/coin/solana:abc/market?tf=1m')).n, 3, 'too old to show: built for this request');
});

test('★ an outage does not replace a good market read while it is still inside keepMs', async () => {
  const r = rig((url, n) => (n === 1 ? { status: 200, body: '{"kind":"read","candles":[]}' } : { status: 200, body: '{"kind":"unavailable","timeframe":"1m"}' }));
  await r.prepared.serve('/coin/solana:abc/market?tf=1m');
  r.advance(5_000);
  await r.prepared.serve('/coin/solana:abc/market?tf=1m');
  await r.settle();
  const kept = await r.prepared.serve('/coin/solana:abc/market?tf=1m');
  assert.equal(kept?.body.toString(), '{"kind":"read","candles":[]}');
  r.advance(60_000);
  const late = await r.prepared.serve('/coin/solana:abc/market?tf=1m');
  assert.equal(late?.body.toString(), '{"kind":"unavailable","timeframe":"1m"}', 'past keepMs the outage is said');
});

test('a reply that is not a 200 is answered and never kept', async () => {
  const r = rig(() => ({ status: 404, body: '{"error":"not found"}' }));
  assert.equal((await r.prepared.serve('/story/gone'))?.status, 404);
  assert.equal((await r.prepared.serve('/story/gone'))?.status, 404);
  assert.equal(r.builds(), 2);
  assert.equal(r.prepared.size(), 0);
});
