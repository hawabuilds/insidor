/**
 * Our trade and launch event reader against the launchpad's own SDK, on logs captured live from
 * the chain on 19 Oct 2026 (__fixtures__/curve-logs.json: SOL trades, trades quoted in other
 * tokens, two launches, a swap-pool transaction, a cut log and a failed one). The SDK is loaded
 * here and nowhere in runtime code: its licence file reads "all rights reserved".
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { base58, curveEvents, openingBuy } from './events.ts';

interface Fixture {
  readonly label: string;
  readonly signature: string;
  readonly err: unknown;
  readonly logs: readonly string[];
}

const FIXTURES: readonly Fixture[] = JSON.parse(readFileSync(new URL('./__fixtures__/curve-logs.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);
const sdk = require('@nirholas/pump-sdk') as { parsePumpEventsFromLogs: (logs: readonly string[]) => { type: string; data: Record<string, { toString(): string; toBase58?: () => string }> }[] };
const key = (k: { toBase58?: () => string; toString(): string } | undefined): string => (k?.toBase58 ? k.toBase58() : String(k));

test('base58 of keys: leading zero bytes are ones, and a known key round-trips', () => {
  assert.equal(base58(new Uint8Array(32)), '11111111111111111111111111111111');
  assert.equal(base58(Uint8Array.from(Buffer.from('0156e0f693665acf44db1568bf175baa5189cb97f5d2ff3b655d2bb6fd6d18b0', 'hex'))), '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
});

test('★ every trade and launch in the captured logs decodes as the SDK reads it', () => {
  let trades = 0;
  let creates = 0;
  for (const f of FIXTURES.filter((x) => x.err === null && x.label !== 'truncated')) {
    const ours = curveEvents(f.logs);
    const theirs = sdk.parsePumpEventsFromLogs(f.logs);
    const theirTrades = theirs.filter((e) => e.type === 'trade');
    assert.equal(ours.trades.length, theirTrades.length, `${f.signature}: trade count`);
    assert.equal(ours.undecodable, 0);
    ours.trades.forEach((t, i) => {
      const d = theirTrades[i]!.data;
      assert.equal(t.mint, key(d['mint']));
      assert.equal(t.user, key(d['user']));
      assert.equal(t.creator, key(d['creator']));
      assert.equal(t.isBuy, String(d['isBuy']) === 'true');
      assert.equal(t.tokens, Number(d['tokenAmount']!.toString()) / 1e6);
      const quote = key(d['quoteMint']);
      assert.equal(t.solQuoted, quote === '11111111111111111111111111111111');
      assert.equal(t.quoteMint, quote, 'the quote is carried as the event names it');
      assert.notEqual(t.mint, t.quoteMint, 'the quote is never the coin');
      if (t.solQuoted) {
        assert.equal(t.sol, Number(d['solAmount']!.toString()) / 1e9);
        const cap = (Number(d['virtualSolReserves']!.toString()) / 1e9) / (Number(d['virtualTokenReserves']!.toString()) / 1e6) * 1e9;
        assert.ok(t.mcapSol !== null && Math.abs(t.mcapSol - cap) < 1e-6);
      } else {
        assert.equal(t.sol, null, 'a trade quoted in another token has no SOL figure, never 0');
        assert.equal(t.mcapSol, null);
      }
      trades += 1;
    });
    const theirCreates = theirs.filter((e) => e.type === 'create');
    assert.deepEqual(ours.creates.map((c) => c.mint), theirCreates.map((c) => key(c.data['mint'])));
    assert.deepEqual(ours.creates.map((c) => c.creator), theirCreates.map((c) => key(c.data['creator'])));
    for (const [i, c] of ours.creates.entries()) {
      const theirQuote = theirCreates[i]!.data['quoteMint'];
      if (theirQuote !== undefined) assert.equal(c.quoteMint, key(theirQuote));
      assert.notEqual(c.mint, c.quoteMint, 'a launch\'s coin is its mint, never what it is priced in');
    }
    creates += ours.creates.length;
  }
  assert.ok(trades >= 20, `fixtures hold real trades (${trades})`);
  assert.ok(FIXTURES.some((f) => f.label === 'trade-other-quote' && curveEvents(f.logs).trades.some((t) => !t.solQuoted)), 'fixtures hold a trade quoted in another token');
  assert.equal(creates, 2);
});

test('a swap-pool transaction carries no launchpad trade: an event from another program is not ours', () => {
  const amm = FIXTURES.find((f) => f.label === 'amm')!;
  assert.equal(curveEvents(amm.logs).trades.length, 0);
});

test('a cut log says so', () => {
  const cut = FIXTURES.find((f) => f.label === 'truncated')!;
  assert.equal(curveEvents(cut.logs).truncated, true);
  assert.equal(FIXTURES.filter((f) => f.label === 'trade').every((f) => !curveEvents(f.logs).truncated), true);
});

test('a data line from a program that is not the launchpad is ignored, even with a trade marker', () => {
  const real = FIXTURES.find((f) => f.label === 'trade')!;
  const line = real.logs.find((l) => l.startsWith('Program data: vdt/'))!;
  const foreign = ['Program 11111111111111111111111111111111 invoke [1]', line, 'Program 11111111111111111111111111111111 success'];
  assert.equal(curveEvents(foreign).trades.length, 0);
  const ours = ['Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]', line, 'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success'];
  assert.equal(curveEvents(ours).trades.length, 1);
});

test('a line cut short is counted undecodable, not read as a smaller trade', () => {
  const real = FIXTURES.find((f) => f.label === 'trade')!;
  const line = real.logs.find((l) => l.startsWith('Program data: vdt/'))!;
  const short = 'Program data: ' + Buffer.from(line.slice(14), 'base64').subarray(0, 120).toString('base64');
  const r = curveEvents(['Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]', short, 'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success']);
  assert.equal(r.trades.length, 0);
  assert.equal(r.undecodable, 1);
});

test('★ the opening buy: the creator\'s own buys in the launch transaction; none of this coin is null', () => {
  const launch = FIXTURES.find((f) => f.label === 'create')!;
  const create = curveEvents(launch.logs).creates[0]!;
  const opening = openingBuy(launch.logs, create.mint);
  assert.ok(opening !== null);
  const sdkOwn = sdk.parsePumpEventsFromLogs(launch.logs).filter((e) => e.type === 'trade' && key(e.data['mint']) === create.mint && key(e.data['user']) === create.creator && String(e.data['isBuy']) === 'true');
  assert.equal(opening.creatorBuySol, sdkOwn.reduce((a, e) => a + Number(e.data['solAmount']!.toString()) / 1e9, 0));
  assert.ok(opening.launchMcapSol !== null && opening.launchMcapSol > 0);
  assert.equal(openingBuy(launch.logs, '11111111111111111111111111111111'), null, 'a log without this coin\'s launch is not "bought nothing"');
});
