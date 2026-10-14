import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { cleanGuesses, exampleShown, guessHit, guessesFirst, nameKeyOf, nearestExamples, sameName, type ExampleVector } from './name-guess.ts';

const P = DEFAULT_POLICY.names;

test('a name key drops case, accents, the $ and spaces', () => {
  assert.equal(nameKeyOf('Flávio Hipotético'), nameKeyOf('FLAVIO HIPOTETICO'));
  assert.equal(nameKeyOf('$GTA 6'), 'gta6');
});

test('one slip apart is the same name only in a long word', () => {
  assert.equal(sameName('Pringles', 'PRINGLE', P), true);
  assert.equal(sameName('GTA', 'GTB', P), false);
  assert.equal(sameName('', '', P), false);
});

test('a guess hits when its name or ticker is the coin\'s name or ticker, either way round', () => {
  const coin = [{ name: 'Rest In Pringles', ticker: 'RIP' }];
  assert.equal(guessHit([{ name: 'RIP', ticker: 'RIPPRINGLES' }], coin, 1, P), true);
  assert.equal(guessHit([{ name: 'Pringles', ticker: 'PRINGLES' }, { name: 'Rest in Pringles', ticker: 'RIP' }], coin, 1, P), false);
  assert.equal(guessHit([{ name: 'Pringles', ticker: 'PRINGLES' }, { name: 'Rest in Pringles', ticker: 'RIP' }], coin, 5, P), true);
});

test('raw guesses come out clean: no $, a ticker made when none came, one per ticker, at most five', () => {
  const out = cleanGuesses([
    { name: '$Altai', ticker: '$altai' },
    { name: 'Altai the Tiger', ticker: 'ALTAI' },
    { name: 'Tiger King', ticker: '' },
    { name: 'Flávio', ticker: 'flávio' },
    { name: 7, ticker: null },
    { name: 'A', ticker: 'A' }, { name: 'B', ticker: 'B' }, { name: 'C', ticker: 'C' },
  ], P);
  assert.deepEqual(out.map((g) => g.ticker), ['ALTAI', 'TIGERKING', 'FLAVIO', 'A', 'B']);
  assert.equal(out[0]?.name, 'Altai');
});

test('a post is never its own example, and examples come closest first', () => {
  const ex = (itemId: string, values: number[]): ExampleVector => ({ itemId, text: itemId, seen: null, coins: [{ name: itemId, ticker: itemId.toUpperCase() }], postedAtMs: null, values });
  const all = [ex('self', [1, 0]), ex('near', [0.9, 0.1]), ex('far', [0, 1])];
  assert.deepEqual(nearestExamples([1, 0], all, 2, (e) => e.itemId === 'self').map((e) => e.itemId), ['near', 'far']);
});

test('an example shows each coin name once', () => {
  const e: ExampleVector = { itemId: 'x:1', text: 'a tiger', seen: null, coins: [{ name: 'Altai', ticker: 'ALTAI' }, { name: 'altai', ticker: 'altai' }], postedAtMs: null, values: [1] };
  assert.equal(exampleShown(e, P).coins.length, 1);
});

test('the Create ideas lead with the guesses, then the judge\'s, one per ticker', () => {
  const bars = { minTicker: 3, maxTicker: 10, maxIdeas: 5, lead: 3 };
  const ideas = guessesFirst(
    [{ name: 'Altai', ticker: 'ALTAI' }, { name: 'Tiger', ticker: 'TIGER' }, { name: 'Brave Tiger Altai', ticker: 'BRAVETIGERALTAI' }, { name: 'Fourth', ticker: 'FOURTH' }],
    [{ name: 'Tiger', ticker: 'TIGER' }, { name: 'Zoo', ticker: 'ZOO' }],
    bars,
  );
  assert.deepEqual(ideas.map((i) => i.ticker), ['ALTAI', 'TIGER', 'BRAVE', 'ZOO']);
  assert.deepEqual(guessesFirst([], [{ name: 'Zoo', ticker: 'ZOO' }], bars), [{ name: 'Zoo', ticker: 'ZOO' }]);
});
