/**
 * "Twitter World War": the meme wars leave the list for one card where the first of them stood,
 * and inside it each fight is one section, whatever order the server named its countries in.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeStory } from '../../shared/api/decode.ts';
import type { Story } from '../../shared/api/index.ts';
import { fixtureStory, sampleNarrativeIds } from '../../test-fixtures/fixtures.ts';
import { fightName, fightSections, itemKey, withWarUmbrella } from './world-war.ts';

const base = decodeStory(fixtureStory(sampleNarrativeIds()[0] ?? '')) as Story;
const s = (id: string, countries: readonly string[] | null = null): Story => ({ ...base, id, countries });

test('★ the meme wars become one card, standing where the first of them was; the rest keep the server\'s order', () => {
  const rows = [s('a'), s('w1', ['China', 'Turkey']), s('b'), s('w2', ['France', 'Japan']), s('c')];
  const items = withWarUmbrella(rows);
  assert.deepEqual(items.map(itemKey), ['a', ' war', 'b', 'c']);
  const war = items[1];
  assert.deepEqual(war?.kind === 'war' ? war.stories.map((x) => x.id) : [], ['w1', 'w2']);
  assert.deepEqual(withWarUmbrella([s('a'), s('b')]).map(itemKey), ['a', 'b'], 'no war loaded: no umbrella');
  assert.deepEqual(withWarUmbrella([s('a', ['China'])]).map(itemKey), ['a'], 'one country is not a fight');
});

test('★ one section per fight, in the server\'s order, whatever order its countries came in', () => {
  const sections = fightSections([s('w1', ['China', 'Turkey']), s('w2', ['France', 'Japan']), s('w3', ['Turkey', 'China']), s('x')]);
  assert.deepEqual(sections.map((f) => [f.name, f.stories.map((x) => x.id)]), [['China vs Turkey', ['w1', 'w3']], ['France vs Japan', ['w2']]]);
  assert.equal(fightName(['Turkey', 'China', 'Greece']), 'China vs Greece vs Turkey');
});

test('a page\'s countries decode only as two or more names; anything else is not a fight, never a broken page', () => {
  assert.deepEqual(decodeStory({ ...(fixtureStory(sampleNarrativeIds()[0] ?? '') as Record<string, unknown>), countries: ['China', 'Turkey'] }).countries, ['China', 'Turkey']);
  assert.equal(decodeStory({ ...(fixtureStory(sampleNarrativeIds()[0] ?? '') as Record<string, unknown>), countries: ['China'] }).countries, null);
  assert.equal(decodeStory({ ...(fixtureStory(sampleNarrativeIds()[0] ?? '') as Record<string, unknown>), countries: 'China vs Turkey' }).countries, null);
  assert.equal(base.countries, null, 'a page that does not say');
});
