import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { nameIdeas, tickerFor } from './name-ideas.ts';

const BARS = { minTicker: 3, maxTicker: 10, maxIdeas: 5 };

describe('tickerFor', () => {
  it('is the name in capitals with spaces and punctuation gone', () => {
    assert.equal(tickerFor('Moo Deng', BARS), 'MOODENG');
    assert.equal(tickerFor('pnut!', BARS), 'PNUT');
  });
  it('uses the first word of a long phrase, else its initials', () => {
    assert.equal(tickerFor('Toly The Claynosaur', BARS), 'TOLY');
    assert.equal(tickerFor('Al Bo Cy Dee Eli Flo', BARS), 'ABCDEF');
  });
  it('drops a name too short for a ticker', () => {
    assert.equal(tickerFor('Al', BARS), null);
  });
  it('never makes a ticker of a filler word', () => {
    assert.equal(tickerFor('the Buck Me ad', BARS), 'BUCKMEAD');
    assert.equal(tickerFor('The Bloodline', BARS), 'BLOODLINE');
    assert.equal(tickerFor('the void', BARS), 'VOID');
    assert.equal(tickerFor('A Big Old Dog Named Fred', BARS), 'BIG');
    assert.equal(tickerFor('My Cat', BARS), 'CAT');
    assert.equal(tickerFor('The', BARS), null);
  });
  it('shortens a long word by its vowels from the end, never by cutting its tail', () => {
    assert.equal(tickerFor('ROLLERDEATH', BARS), 'ROLLERDETH');
    assert.equal(tickerFor('ROLLCOASTER DEATH', BARS), 'ROLLCOASTR');
    assert.equal(tickerFor('Hippopotamus', BARS), 'HIPPOPOTMS');
  });
  it('drops a word no shortening can fit rather than cutting it', () => {
    assert.equal(tickerFor('Supercalifragilistic', BARS), null);
  });
});

describe('nameIdeas', () => {
  it('puts one-word names first, keeps the judge order within each, and one idea per ticker', () => {
    const ideas = nameIdeas('Aura Bird', ['Stork', 'AURABIRD', 'Bird of Aura', 'stork'], BARS);
    assert.deepEqual(ideas, [
      { name: 'Stork', ticker: 'STORK' },
      { name: 'AURABIRD', ticker: 'AURABIRD' },
      { name: 'Bird of Aura', ticker: 'BIRDOFAURA' },
    ]);
  });
  it('gives at most the cap, and nothing from no names', () => {
    assert.equal(nameIdeas('One', ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven'], BARS).length, 5);
    assert.deepEqual(nameIdeas(null, [], BARS), []);
  });
});
