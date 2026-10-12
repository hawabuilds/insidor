import { test } from 'node:test';
import assert from 'node:assert/strict';

import { showsLanding } from './entered.ts';

test('the front door shows on the bare address to someone not yet in, and never over a shared link', () => {
  assert.equal(showsLanding('', false, false), true);
  assert.equal(showsLanding('#/', false, false), true);
  assert.equal(showsLanding('#/story/st_1', false, false), false, 'a shared story opens straight in');
  assert.equal(showsLanding('#/', true, false), false, 'someone let in before goes straight in');
  assert.equal(showsLanding('#/', false, true), false, 'signed in goes straight in');
});
