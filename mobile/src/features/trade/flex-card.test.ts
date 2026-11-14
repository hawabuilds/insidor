import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CARD_H, CARD_W, COLOURS, backdropChoices, capText, clockText, coverCrop, fileName, layoutCard, leftOff, multipleText, profitText, type FlexFacts, type Measure } from './flex-card.ts';

/* A stand-in for the canvas's measure: every character 0.6 of the font's size, plus the spacing. */
const measure: Measure = (text, font, spacing = 0) => {
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
  return [...text].length * (px * 0.6 + spacing);
};

const FULL: FlexFacts = {
  ticker: 'Peekhole',
  subline: 'paired with TTWO',
  multiple: 4.4,
  boughtCapUsd: 9_000,
  soldCapUsd: 39_600,
  profitSol: 1.7,
  author: '@GTAWikiOfficial',
  postedAt: Date.UTC(2026, 9, 23, 15, 41),
  me: '@hawa',
};
const ALL_ON = { showProfit: true, showMe: true };

test('★ the words: caps, the multiple and the profit as the approved card writes them', () => {
  assert.equal(capText(9_000), '$9k');
  assert.equal(capText(39_600), '$39.6k');
  assert.equal(capText(18_542.17), '$18.5k');
  assert.equal(capText(254_300), '$254k');
  assert.equal(capText(1_240_000), '$1.24M');
  assert.equal(capText(950), '$950');
  assert.equal(multipleText(4.4), '4.4×');
  assert.equal(multipleText(164.2), '164×');
  assert.equal(multipleText(0.9163), '0.92×');
  assert.equal(multipleText(1), '1×');
  assert.equal(profitText(1.7), '+1.70 SOL');
  /* A loss keeps its minus, and a small one is never rounded to a zero. */
  assert.equal(profitText(-0.005939627), '−0.0059 SOL');
  assert.equal(profitText(-0.000493828), '−0.00049 SOL');
  assert.equal(profitText(-0.69), '−0.69 SOL');
  assert.equal(clockText(Date.UTC(2026, 9, 23, 15, 41), 'Europe/London'), '16:41');
});

test('★ the mockup\'s places: the pill at 28,24, the logo and multiple bottom left, the stats right, the last line 30 from the foot', () => {
  const L = layoutCard(FULL, ALL_ON, measure);
  assert.equal(L.pill.x, 28);
  assert.equal(L.pill.y, 24);
  assert.equal(L.pill.h, 54);
  assert.equal(L.logo.x, 36);
  assert.equal(L.logo.size, 92);
  assert.ok(L.multiple !== null);
  assert.equal(L.multiple.x, 36 + 92 + 13);
  assert.equal(L.multiple.size, 104);
  assert.equal(L.multiple.colour, COLOURS.up);
  assert.deepEqual(L.stats.map((s) => [s.label, s.value]), [['BOUGHT', '$9k'], ['SOLD', '$39.6k'], ['PROFIT', '+1.70 SOL']]);
  assert.equal(L.stats[1]?.colour, COLOURS.up);
  /* The stats end at the right padding. */
  const last = L.stats[2];
  assert.ok(last !== undefined);
  assert.ok(Math.abs(last.x + Math.max(measure('PROFIT', '600 11px Inter', 1.32), measure('+1.70 SOL', '600 19px x')) - (CARD_W - 36)) < 1e-9);
  /* The last line's pictures sit 30 above the foot; the logo row's foot 14 above them. */
  assert.ok(L.author !== null && L.me !== null);
  assert.equal(L.author.picture.y + L.author.picture.size, CARD_H - 30);
  assert.equal(L.logo.y + L.logo.size + (104 * 0.9 - 92) / 2, CARD_H - 30 - 22 - 14);
  assert.equal(L.author.rest?.text, ` posted it at ${clockText(FULL.postedAt ?? 0)}`);
  /* Every @ has its picture: the person's own sits just left of it. */
  assert.equal(L.me.picture.x + L.me.picture.size + 8, L.me.handle.x);
  assert.ok(L.bandTop > CARD_H * 0.4 && L.bandTop < CARD_H * 0.43);
});

test('★ a loss is drawn as a loss: a red multiple, a red SOLD under the entry and a red profit with its minus', () => {
  const L = layoutCard({ ...FULL, multiple: 0.92, boughtCapUsd: 18_542, soldCapUsd: 16_990, profitSol: -0.0059 }, ALL_ON, measure);
  assert.equal(L.multiple?.colour, COLOURS.down);
  assert.equal(L.multiple?.text, '0.92×');
  assert.equal(L.stats.find((s) => s.label === 'SOLD')?.colour, COLOURS.down);
  const profit = L.stats.find((s) => s.label === 'PROFIT');
  assert.equal(profit?.colour, COLOURS.down);
  assert.equal(profit?.value, '−0.0059 SOL');
});

test('★ an unknown is left off and the rest close up, never drawn as a zero', () => {
  const L = layoutCard({ ...FULL, multiple: null, boughtCapUsd: null, profitSol: null, author: null, postedAt: null }, { showProfit: true, showMe: false }, measure);
  assert.equal(L.multiple, null);
  assert.deepEqual(L.stats.map((s) => s.label), ['SOLD']);
  /* No entry: SOLD cannot say up or down, so it is white. */
  assert.equal(L.stats[0]?.colour, COLOURS.t1);
  /* No author and the @ switched off: no last line, the logo row drops to the foot. */
  assert.equal(L.author, null);
  assert.equal(L.me, null);
  assert.equal(L.logo.y + L.logo.size, CARD_H - 30);
  /* A post with no time: the handle stays, "posted it at" goes. */
  const untimed = layoutCard({ ...FULL, postedAt: null }, ALL_ON, measure);
  assert.equal(untimed.author?.rest, null);
  /* Profit switched off. */
  assert.ok(!layoutCard(FULL, { showProfit: false, showMe: true }, measure).stats.some((s) => s.label === 'PROFIT'));
  /* No second line in the pill. */
  assert.equal(layoutCard({ ...FULL, subline: null }, ALL_ON, measure).pill.sub, null);
});

test('★ a wide multiple shrinks so it never runs into the stats', () => {
  const L = layoutCard({ ...FULL, multiple: 0.92, profitSol: -0.000493828, boughtCapUsd: 1_240_000, soldCapUsd: 1_130_000 }, ALL_ON, measure);
  assert.ok(L.multiple !== null);
  const right = L.multiple.x + measure(L.multiple.text, `800 ${L.multiple.size}px Inter`, -0.06 * L.multiple.size);
  const firstStat = L.stats[0];
  assert.ok(firstStat !== undefined);
  assert.ok(right <= firstStat.x, `${right} runs into ${firstStat.x}`);
  assert.ok(L.multiple.size < 104);
});

test('the post is offered only when its picture is ours to draw; a picture covers its box from the centre', () => {
  assert.deepEqual(backdropChoices(true), ['post', 'insidor', 'mine']);
  assert.deepEqual(backdropChoices(false), ['insidor', 'mine']);
  /* A square picture on a 16:9 card loses its top and bottom equally. */
  assert.deepEqual(coverCrop(1000, 1000, 720, 405), { sx: 0, sy: 218.75, sw: 1000, sh: 562.5 });
  assert.equal(fileName('$SIDE EYE', 0.92), 'insidor-SIDEEYE-0_92x.png');
  assert.equal(fileName('Himmel', null), 'insidor-Himmel.png');
});

test('★ what the card leaves off is said in one plain line each', () => {
  const base = {
    kind: 'read' as const,
    mint: 'M',
    ticker: 'X',
    name: null,
    boughtCapUsd: { v: 1, why: null },
    soldCapUsd: { v: 1, why: null },
    multiple: { v: 1, why: null },
    profitSol: { v: 1, why: null },
    post: { postedAt: 1, author: '@a', authorPictureFile: null, authorPictureUrl: null, pictureFile: 'f'.repeat(32), pictureUrl: null },
  };
  assert.deepEqual(leftOff(base, true), []);
  assert.equal(leftOff({ ...base, post: null }, false).length, 1);
  assert.match(leftOff({ ...base, post: { ...base.post, pictureFile: null } }, false)[0] ?? '', /post has no picture/);
  assert.match(leftOff({ ...base, post: { ...base.post, pictureFile: null, pictureUrl: 'https://pic.example/a.jpg' } }, false)[0] ?? '', /couldn't be loaded/);
  assert.match(leftOff({ ...base, profitSol: { v: null, why: 'bought_elsewhere' } }, true)[0] ?? '', /sold more than you bought/);
  const elsewhere = leftOff({ ...base, boughtCapUsd: { v: null, why: 'not_bought_here' }, multiple: { v: null, why: 'not_bought_here' }, profitSol: { v: null, why: 'not_bought_here' } }, true);
  assert.equal(elsewhere.length, 1);
});
