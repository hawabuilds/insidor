/**
 * The language-drop rule (notify/language-drop.ts): a rolling window against the same window a
 * day before, a baseline floor, recovery against what it fell from, and a whole-source drop said
 * once instead of per language.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { dropped, recovered, replayLanguageDrops, type LanguageFinds } from './language-drop.ts';

const P = DEFAULT_POLICY.notify.languageDrop;
const H = 3_600_000;
const DAY = P.baselineAgoMs;
/* 16 Oct 2026 00:00 UTC, the day before the bug's first full day. */
const T0 = 1_792_108_800_000;

/** `perHour(lang, hourIndex)` finds each hour from T0 − 1 day for `hours` hours, in ten-minute buckets. */
function series(langs: readonly string[], hours: number, perHour: (lang: string, h: number) => number): LanguageFinds[] {
  const out: LanguageFinds[] = [];
  for (const lang of langs)
    for (let h = 0; h < hours; h += 1) {
      const n = perHour(lang, h);
      for (let k = 0; k < 6; k += 1) out.push({ lang, atMs: T0 - DAY + h * H + k * P.everyMs, finds: Math.round(n / 6) });
    }
  return out;
}

test('down below 30% of a baseline of at least 30; back at half of what it fell from', () => {
  assert.equal(dropped(29, 100, P), true);
  assert.equal(dropped(30, 100, P), false, 'a 70% drop exactly is not more than 70%');
  assert.equal(dropped(0, 29, P), false, 'too few in the baseline to say: never down');
  assert.equal(dropped(0, 0, P), false, 'a language added today has no baseline and never goes down');
  assert.equal(recovered(49, 100, P), false);
  assert.equal(recovered(50, 100, P), true);
});

test('★ the 16 Oct bug: English falls while Japanese rises; English is said down once, inside three hours, and back once', () => {
  /* Day 1 (hours 0-23) normal: en 300/h, ja 0. From hour 47 (23:00 on day 2) en 10/h and ja 300/h; from hour 60 en is fixed. */
  const buckets = series(['en', 'ja'], 72, (lang, h) => (lang === 'en' ? (h >= 47 && h < 60 ? 12 : 300) : h >= 47 ? 300 : 0));
  const r = replayLanguageDrops(buckets, T0 + 6 * H, T0 + 2 * DAY - P.everyMs, P);
  const en = r.changes.filter((c) => c.lang === 'en');
  assert.deepEqual(en.map((c) => c.state), ['down', 'back']);
  const down = en[0]!;
  assert.ok(down.atMs > T0 + 23 * H && down.atMs <= T0 + 26 * H, 'said within three hours of the drop');
  assert.equal(down.inWhole, false, "the source's total held up: a language's drop, said on its own");
  assert.equal(en[1]!.sinceMs, down.sinceMs, 'the back names the same drop');
  assert.equal(r.changes.filter((c) => c.lang === 'ja').length, 0, 'a language rising from nothing is never down');
  assert.equal(r.changes.filter((c) => c.lang === null).length, 0);
});

test('a drop that lasts past a day stays one drop: the broken day as baseline does not make it look recovered', () => {
  const buckets = series(['en'], 96, (_l, h) => (h >= 30 ? 10 : 300));
  const r = replayLanguageDrops(buckets, T0 + 6 * H, T0 + 3 * DAY - P.everyMs, P);
  assert.deepEqual(r.changes.filter((c) => c.lang === 'en').map((c) => c.state), ['down']);
  assert.notEqual(r.now.find((l) => l.lang === 'en')?.downSinceMs ?? null, null);
});

test('every language falling together is the whole source down: its languages are marked inside it', () => {
  const buckets = series(['en', 'es'], 72, (lang, h) => (h >= 30 && h < 40 ? 0 : lang === 'en' ? 300 : 40));
  const r = replayLanguageDrops(buckets, T0 + 6 * H, T0 + 2 * DAY - P.everyMs, P);
  const whole = r.changes.filter((c) => c.lang === null);
  assert.deepEqual(whole.map((c) => c.state), ['down', 'back']);
  const langs = r.changes.filter((c) => c.lang !== null);
  assert.ok(langs.length > 0);
  assert.ok(langs.every((c) => c.inWhole), 'en and es fell inside the whole drop: not said one by one');
});

test("a small language's quiet hours never alarm", () => {
  /* 8 an hour: 24 in three hours, under the floor of 30 — it can go to nothing and say nothing. */
  const buckets = series(['pt'], 72, (_l, h) => (h % 24 < 12 ? 8 : 0));
  const r = replayLanguageDrops(buckets, T0 + 6 * H, T0 + 2 * DAY - P.everyMs, P);
  assert.equal(r.changes.length, 0);
});
