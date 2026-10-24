/**
 * The early pick on the 24 Oct baldcat case, as read: the cat post's launch wave at 00:57:47 UTC,
 * when $baldcat (launched 00:48:58, linking the post through a promotion that quoted it) read $14,275
 * and its rivals of the same two minutes read $2,855 to $4,099 or nothing. It takes the pick only as a
 * coin made for the post, inside its first half hour, in the $12K-$20K band, at five times every rise.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { earlyPick, riseOf, type EarlyBars, type EarlyCoin } from './early-pick.ts';

const E = DEFAULT_POLICY.oneCoin.early;
const BARS: EarlyBars = { minCapUsd: E.minCapUsd, maxCapUsd: E.maxCapUsd, lead: E.lead, fromMs: E.fromMs, withinMs: E.withinMs, rivalWithinMs: E.rivalWithinMs, readingWithinMs: E.readingWithinMs, openingCapUsd: DEFAULT_POLICY.oneCoin.openingCapUsd, minLiquidityUsd: DEFAULT_POLICY.oneCoin.minLiquidityUsd };
const MIN = 60_000;
const LAUNCH = Date.UTC(2026, 9, 24, 0, 48, 58);
const NOW = LAUNCH + 8.8 * MIN;
const read = (capUsd: number, atMs = NOW, liquidityUsd: number | null = null) => ({ capUsd, readAtMs: atMs, liquidityUsd });

const BALDCAT: EarlyCoin = { address: 'FFPSPa', launchedAtMs: LAUNCH, ties: ['link', 'picture'], reading: read(14_275) };
const WAVE: readonly EarlyCoin[] = [
  BALDCAT,
  { address: '5d8aJH', launchedAtMs: LAUNCH + 4_000, ties: ['link', 'picture'], reading: read(3_069) },
  { address: '7whrRz', launchedAtMs: LAUNCH + 50_000, ties: ['link', 'picture'], reading: read(2_855) },
  { address: 'H57zAX', launchedAtMs: LAUNCH + 92_000, ties: ['link', 'picture'], reading: read(4_099, NOW - 1.5 * MIN) },
  { address: 'F5NHBB', launchedAtMs: LAUNCH + 93_000, ties: ['link', 'picture'], reading: null },
  /* The incumbent: $CAT, launched three and a half hours before, held the post's pick at $36K. */
  { address: 'CAT', launchedAtMs: LAUNCH - 3.5 * 60 * MIN, ties: ['name_guess'], reading: read(36_009) },
];

test('★ baldcat takes the cat post at +8.8 minutes and $14.3K, the rivals unread or flat', () => {
  const p = earlyPick(WAVE, NOW, BARS);
  assert.ok(p !== null);
  assert.equal(p.address, 'FFPSPa');
  assert.equal(p.capUsd, 14_275);
  assert.equal(Math.round(p.ageMs / 6_000) / 10, 8.8);
  assert.equal(p.rivals, 4, 'the incumbent launched hours before is not in the wave');
  assert.equal(p.rivalsUnread, 1);
  assert.equal(p.rivalRiseUsd, 4_099 - BARS.openingCapUsd);
});

test('only a coin made for the post: a picture or a shared name is not enough', () => {
  assert.equal(earlyPick([{ ...BALDCAT, ties: ['picture', 'name_judge'] }, ...WAVE.slice(1)], NOW, BARS), null);
  assert.equal(earlyPick([{ ...BALDCAT, ties: ['name_stated'] }, ...WAVE.slice(1)], NOW, BARS)?.address, 'FFPSPa', 'the whole stated name ties as the link does');
});

test('the band: under $12K is noise, at $20K the ordinary rule has it', () => {
  assert.equal(earlyPick([{ ...BALDCAT, reading: read(5_875) }, ...WAVE.slice(1)], NOW, BARS), null, 'its +3.7 min reading');
  assert.equal(earlyPick([{ ...BALDCAT, reading: read(20_000) }, ...WAVE.slice(1)], NOW, BARS), null);
});

test('the half hour, and a fresh pooled reading of its own', () => {
  assert.equal(earlyPick(WAVE, LAUNCH + MIN, BARS), null, 'too young: every coin is at its opening cap');
  assert.equal(earlyPick(WAVE, LAUNCH + 31 * MIN, BARS), null, 'past half an hour the ordinary rule has the readings it needs');
  assert.equal(earlyPick([{ ...BALDCAT, reading: read(14_275, NOW - 9 * MIN) }, ...WAVE.slice(1)], NOW, BARS), null, 'a reading older than a pass is not now');
  assert.equal(earlyPick([{ ...BALDCAT, reading: read(14_275, NOW, 0.27) }, ...WAVE.slice(1)], NOW, BARS), null, 'a frozen quote is not a cap');
  assert.equal(earlyPick([{ ...BALDCAT, launchedAtMs: null }, ...WAVE.slice(1)], NOW, BARS), null, 'an unknown launch has no age');
});

test('★ five times every rival, or nothing', () => {
  const close = { address: 'RIVAL', launchedAtMs: LAUNCH + 10_000, ties: ['name_guess'] as const, reading: read(5_500) };
  assert.equal(earlyPick([...WAVE, close], NOW, BARS), null, '$11.4K of rise against $2.6K is under five times');
  assert.equal(earlyPick([...WAVE, { ...close, reading: read(5_500, NOW, 0.01) }], NOW, BARS)?.address, 'FFPSPa', "a rival's frozen quote rises nothing");
  assert.equal(riseOf({ ...close, reading: read(2_000) }, BARS), 0, 'under the opening cap is no rise, not a fall');
});

test('two close coins of one wave: neither, and one alone needs no lead', () => {
  const twin = { ...BALDCAT, address: 'TWIN', reading: read(19_000) };
  assert.equal(earlyPick([BALDCAT, twin], NOW, BARS), null, 'each is the other\'s rival: neither is five times the other');
  assert.equal(earlyPick([twin], NOW, BARS)?.rivals, 0, 'alone in its wave it needs no lead');
});
