/**
 * `combinedMeter`: a test on the learning book is refused BEFORE it calls when it would cross the
 * tests' own day, and its rows carry the tests' prefix in the book. Meters in memory, no database.
 * Run: node --test --experimental-strip-types tools/lib/shared-meter.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Spend } from '../../contracts/src/ports/meter.ts';
import { inMemoryMeter } from '../../adapters/meter/spend/src/index.ts';
import { combinedMeter } from './shared-meter.ts';

const AT = 1_800_036_000_000;
const now = () => AT;
const spend = (vendor: string, usd: number): Spend => ({ vendor, endpoint: 'judge', unit: 'per-call', units: 1, usd, at: AT });

test("★ a test is refused before it would cross the tests' $1 day, whichever vendor it is", () => {
  const own = inMemoryMeter({ dailyCapUsd: 3, softStop: 1, now });
  const book = inMemoryMeter({ dailyCapUsd: 6.5, softStop: 1, now });
  const tests = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now });
  const m = combinedMeter({ own, shared: book, tests, prefix: 'learn:test:' });
  m.record(spend('openrouter', 0.7));
  assert.equal(m.mayspend('together', 0.2), true);
  assert.equal(m.mayspend('together', 0.4), false, '$0.70 + $0.40 crosses $1 though the stage cap and the book have room');
  assert.ok(Math.abs(m.line('together').remainingUsd - 0.3) < 1e-9);
  assert.equal(book.entries()[0]?.endpoint, 'learn:test:judge', 'the row is labelled a test in the book');
});

test("the re-tune has no tests' line: only its stage cap and the whole book", () => {
  const own = inMemoryMeter({ dailyCapUsd: 8.5, softStop: 1, now });
  const book = inMemoryMeter({ dailyCapUsd: 8.5, softStop: 1, now });
  const m = combinedMeter({ own, shared: book, tests: null, prefix: 'learn:' });
  m.record(spend('openrouter', 0.7));
  assert.equal(m.mayspend('openrouter', 2), true);
  assert.equal(book.entries()[0]?.endpoint, 'learn:judge');
});
