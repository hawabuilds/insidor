/** A narrative stays only with enough passing posts, lists only those, and says why for the rest. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY as P } from '@insidor/contracts/policy.ts';

import { checkNarratives } from './narrative-rules.ts';
import type { StoryFacts } from './project.ts';

const story = (id: string, members: readonly string[]): StoryFacts => ({ storyId: id, members: members.map((itemId) => ({ itemId })) }) as unknown as StoryFacts;

test('★ a narrative with fewer passing posts than the rule is hidden, with how many passed', () => {
  const r = checkNarratives([story('s1', ['a', 'b', 'c'])], new Map([['a', 'passes'], ['b', 'not_memeable']]), P);
  assert.deepEqual(r.kept, []);
  assert.deepEqual(r.rejections, [{ kind: 'narrative', id: 's1', reason: 'too_few_passing_posts', detail: '1 of 3 posts pass' }]);
});

test('a narrative that qualifies keeps only its passing posts; an unscored post is not passing', () => {
  const r = checkNarratives([story('s2', ['a', 'b', 'c'])], new Map([['a', 'passes'], ['b', 'passes']]), P);
  assert.deepEqual(r.kept[0]?.members.map((m) => m.itemId), ['a', 'b']);
  assert.deepEqual(r.rejections, [{ kind: 'post', id: 'c', reason: 'not_scored', detail: 'dropped from s2' }]);
});
