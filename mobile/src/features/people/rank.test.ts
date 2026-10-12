import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { RANK_LINE, rankCardLine, shareText, withArticle } from './rank.ts';

test("the rank card says what is left to climb, in Trador's words", () => {
  assert.equal(rankCardLine({ rank: 'analyst', topOfSeason: false, next: { rank: 'quant', repToGo: 588 } }), '588 rep to Quant');
  assert.equal(rankCardLine({ rank: 'goat', topOfSeason: true, next: null }), 'Top 1% this season');
  assert.equal(rankCardLine({ rank: 'wolf', topOfSeason: false, next: null }), 'Top of Wolf');
});

test('an Analyst, a Quant; and none of the stock-market lines', () => {
  assert.equal(withArticle('analyst'), 'an Analyst');
  assert.equal(withArticle('intern'), 'an Intern');
  assert.equal(withArticle('quant'), 'a Quant');
  assert.equal(shareText('analyst', 2), "I'm an Analyst on Insidor. Season 2.");
  for (const line of Object.values(RANK_LINE)) assert.ok(!/Wall Street|charts|stock/i.test(line), line);
});
