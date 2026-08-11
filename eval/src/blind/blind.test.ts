/**
 * The blind protocol's own tests.
 *
 * These check the property the previous version could not prove about itself:
 * that the artefact handed to a human contains no route to the answer. The
 * value-level assertions are modelled on the projection test that guards the
 * public board — reading VALUES rather than key names, because a leak nested
 * inside an object is exactly the kind a key allowlist waves through.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { shuffle, mulberry32 } from './seeded-random.ts';
import { buildBlindSheet } from './sheet.ts';
import type { BlindUnit } from './sheet.ts';
import { assertBlind, redact, BlindnessError, FORBIDDEN_SUBSTRINGS } from './redact.ts';
import { reveal, renderReveal, RevealError } from './reveal.ts';
import type { FilledRow } from './reveal.ts';

const META = {
  sheetId: 'wave-4',
  population: 'stories promoted between 2026-05-01 and 2026-07-31, all sources, gated lane',
  labelSource: 'dune:peak_multiple_v1@3f9a1c2',
  labelWindowDays: 6,
  seed: 42,
};

function unit(i: number, over: Partial<BlindUnit> = {}): BlindUnit {
  return {
    unitId: `unit-${i}`,
    postText: `a post about something ${i}`,
    postImageUri: `https://cdn.example.net/media/${i}.jpg`,
    postedAt: '2026-06-01T00:00:00.000Z',
    authorFollowers: 1000 + i,
    reachAtCapture: 50_000 + i,
    replyCount: i,
    outcome: {
      group: i % 2 === 0 ? 'winner' : 'loser',
      peakMultiple: i % 2 === 0 ? 18.2 : 1.19,
      mintAddress: `So1111111111111111111111111111111111111${i}`,
      coinUrl: `https://dexscreener.com/solana/xyz${i}`,
    },
    ...over,
  };
}

const units = Array.from({ length: 12 }, (_, i) => unit(i));

/* ── the shuffle ──────────────────────────────────────────────────────── */

test('the shuffle reproduces exactly from its seed', () => {
  const a = shuffle(units, 42).map((u) => u.unitId);
  const b = shuffle(units, 42).map((u) => u.unitId);
  const c = shuffle(units, 43).map((u) => u.unitId);
  assert.deepEqual(a, b, 'the same seed must give the same wave, forever');
  assert.notDeepEqual(a, c);
  assert.deepEqual([...a].sort(), units.map((u) => u.unitId).sort(), 'a shuffle must not lose or add rows');
});

test('the generator does not mutate its input', () => {
  const before = units.map((u) => u.unitId);
  shuffle(units, 7);
  assert.deepEqual(units.map((u) => u.unitId), before);
});

test('mulberry32 stays inside [0, 1)', () => {
  const rand = mulberry32(42);
  for (let i = 0; i < 1000; i++) {
    const v = rand();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

/* ── blindness ────────────────────────────────────────────────────────── */

test('the sheet carries no outcome, no address and no link to a coin page', () => {
  const { sheet } = buildBlindSheet(units, META);
  assert.equal(sheet.rows.length, units.length);

  // Read the VALUES. This is the check the previous protocol did not have: its
  // sheet legitimately omitted the outcome COLUMN and still carried the coin's
  // page URL and raw mint address, and one click showed the price history.
  for (const row of sheet.rows) {
    const scanned = { ...(row as unknown as Record<string, unknown>) };
    delete scanned['postText'];
    delete scanned['postImageUri'];
    const json = JSON.stringify(scanned).toLowerCase();
    for (const needle of FORBIDDEN_SUBSTRINGS) {
      assert.ok(!json.includes(needle), `"${needle}" reached the sheet: ${json}`);
    }
  }
});

test('the sheet cannot be joined to outcomes without the answer file', () => {
  const { sheet, answers } = buildBlindSheet(units, META);
  // The case key is a digest under a salt that exists only in the answer file.
  // Holding the sheet and the whole production database is not enough.
  for (const row of sheet.rows) {
    assert.match(row.caseKey, /^[0-9a-f]{16}$/);
    assert.ok(!units.some((u) => u.unitId === row.caseKey));
  }
  assert.match(answers.salt, /^[0-9a-f]{32}$/);
  assert.match(answers.WARNING, /DO NOT OPEN/);
});

test('a field outside the allowlist is refused rather than dropped quietly', () => {
  assert.throws(() => assertBlind({ caseKey: 'a', peakMultiple: 18 }), BlindnessError);
  // redact() drops it; assertBlind() is what makes the drop visible in a test.
  assert.deepEqual(Object.keys(redact({ caseKey: 'a', peakMultiple: 18 })), ['caseKey']);
});

test('an outcome smuggled inside a nested value is caught', () => {
  assert.throws(
    () => assertBlind({ caseKey: 'a', postedAt: 'winner cohort 2026-06-01' }),
    BlindnessError,
  );
});

test('an image uri pointing at a market page is refused; an ordinary one is not', () => {
  assert.doesNotThrow(() => assertBlind({ caseKey: 'a', postImageUri: 'https://cdn.example.net/1.jpg' }));
  assert.throws(
    () => assertBlind({ caseKey: 'a', postImageUri: 'https://dexscreener.com/solana/abc' }),
    BlindnessError,
  );
});

test('a wave must declare its population', () => {
  assert.throws(() => buildBlindSheet(units, { ...META, population: '  ' }), /population/);
});

test('units from an earlier wave can be excluded by id', () => {
  // Excluding wave 2's units by id is what made cross-wave replication checkable
  // at all — and checking it is what revealed three of four "strongest" features
  // flipping sign between waves.
  const { sheet } = buildBlindSheet(units, { ...META, excludeUnitIds: ['unit-0', 'unit-1'] });
  assert.equal(sheet.rows.length, units.length - 2);
});

/* ── the reveal ───────────────────────────────────────────────────────── */

const groupOf = (o: Readonly<Record<string, unknown>>): string => String(o['group']);

function fill(keys: readonly string[], f: (i: number) => boolean): FilledRow[] {
  return keys.map((caseKey, i) => ({ caseKey, labels: { hasCharacter: f(i), worksAsPhoto: i < 2 } }));
}

test('a partial sheet cannot be revealed', () => {
  const { sheet, answers } = buildBlindSheet(units, META);
  const partial = fill(sheet.rows.slice(0, 5).map((r) => r.caseKey), (i) => i % 2 === 0);
  assert.throws(() => reveal(sheet, partial, answers, groupOf), RevealError);
});

test('a sheet cannot be revealed against another wave’s answers', () => {
  const a = buildBlindSheet(units, META);
  const b = buildBlindSheet(units, { ...META, sheetId: 'wave-5' });
  const filled = fill(a.sheet.rows.map((r) => r.caseKey), (i) => i % 2 === 0);
  assert.throws(() => reveal(a.sheet, filled, b.answers, groupOf), RevealError);
});

test('the reveal reports rates by group with its population attached', () => {
  const { sheet, answers } = buildBlindSheet(units, META);
  const filled = fill(sheet.rows.map((r) => r.caseKey), (i) => i % 3 === 0);
  const r = reveal(sheet, filled, answers, groupOf);

  assert.deepEqual([...r.groups], ['loser', 'winner']);
  assert.equal(r.population, META.population);
  assert.equal(r.labelSource, META.labelSource);
  assert.ok(r.cells.length > 0);

  const md = renderReveal(r);
  assert.match(md, /Population/);
  assert.match(md, /Label source/);
  assert.match(md, /Descriptive only/);
});

test('cells computed from fewer than five observations are flagged', () => {
  const small = units.slice(0, 4);
  const { sheet, answers } = buildBlindSheet(small, META);
  const filled = fill(sheet.rows.map((r) => r.caseKey), (i) => i % 2 === 0);
  const r = reveal(sheet, filled, answers, groupOf);
  assert.ok(r.cells.every((c) => c.underpowered), 'every cell here is n<5 and must say so');
  assert.match(renderReveal(r), /⚠/);
});
