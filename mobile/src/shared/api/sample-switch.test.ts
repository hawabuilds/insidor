import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sampleSwitchProblem } from './sample-switch.ts';

test('a build without the old sample switch builds', () => {
  assert.equal(sampleSwitchProblem({}), null);
  assert.equal(sampleSwitchProblem({ VITE_SAMPLE_DATA: '' }), null);
  assert.equal(sampleSwitchProblem({ VITE_READ_URL: 'https://read.example' }), null);
});

test('★ a build that still asks for sample data is refused: sample data no longer exists', () => {
  for (const v of ['on', 'true', 'yes']) assert.match(sampleSwitchProblem({ VITE_SAMPLE_DATA: v }) ?? '', /no longer exists/, v);
});
