import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { returningRun, steadyRun, volumeBot, type BotMinute, type VolumeBotBars } from './volume-bot.ts';

const BARS: VolumeBotBars = { minutes: 4, minBuyers: 100, newShareBelow: 0.3, steadyMinBuys: 30, steadyWithin: 2 };
const at = (i: number): number => 1_700_000_000_000 + i * 60_000;
const m = (i: number, buys: number, buyers: number, newBuyers: number): BotMinute => ({ t: at(i), buys, buyers, newBuyers });

test('★ $Grok, 9 Nov: the same wallets every minute and the same buy count is a volume bot', () => {
  /* 23:44-23:53 as recorded: 133, 133, 133, 129, 134, then 118, 112, 112, 112, 112 buys a minute. */
  const grok = [m(0, 133, 133, 40), m(1, 133, 133, 35), m(2, 133, 133, 37), m(3, 129, 129, 36), m(4, 134, 134, 31), m(5, 118, 115, 29), m(6, 112, 107, 33), m(7, 112, 109, 35), m(8, 112, 110, 33), m(9, 112, 109, 40)];
  assert.ok(volumeBot(grok, BARS));
});

test('★ both signs, never one: busy real trading with returning traders but a moving count is not a bot', () => {
  const real = [m(0, 640, 600, 120), m(1, 910, 850, 150), m(2, 720, 700, 130), m(3, 1180, 1100, 200), m(4, 860, 800, 140)];
  assert.ok(returningRun(real, BARS), 'returning traders alone');
  assert.equal(steadyRun(real, BARS), false);
  assert.equal(volumeBot(real, BARS), false);
  const steadyNew = [m(0, 60, 60, 50), m(1, 61, 61, 48), m(2, 60, 60, 52), m(3, 62, 62, 51)];
  assert.ok(steadyRun(steadyNew, BARS), 'a steady count alone');
  assert.equal(volumeBot(steadyNew, BARS), false);
});

test('a gap breaks a run, and a run needs its full length', () => {
  const gap = [m(0, 112, 110, 20), m(1, 112, 110, 20), m(3, 112, 110, 20), m(4, 112, 110, 20)];
  assert.equal(steadyRun(gap, BARS), false, 'minute 2 missing');
  assert.equal(returningRun(gap, BARS), false);
  const short = [m(0, 112, 110, 20), m(1, 112, 110, 20), m(2, 112, 110, 20)];
  assert.equal(volumeBot(short, BARS), false, 'three minutes is not four');
});

test('a steady run is measured from its first minute: a slow drift past the band ends it', () => {
  const drift = [m(0, 100, 100, 10), m(1, 102, 102, 10), m(2, 104, 104, 10), m(3, 106, 106, 10)];
  assert.equal(steadyRun(drift, BARS), false);
});
