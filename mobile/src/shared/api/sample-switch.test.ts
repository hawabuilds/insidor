import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sampleSwitchProblem } from './sample-switch.ts';

test('unset is fine, and so is on with no read service', () => {
  assert.equal(sampleSwitchProblem({}), null);
  assert.equal(sampleSwitchProblem({ VITE_SAMPLE_DATA: '' }), null);
  assert.equal(sampleSwitchProblem({ VITE_SAMPLE_DATA: 'on' }), null);
  assert.equal(sampleSwitchProblem({ VITE_READ_URL: 'https://read.example' }), null);
});

test('sample data beside a real read service fails the build', () => {
  assert.match(sampleSwitchProblem({ VITE_SAMPLE_DATA: 'on', VITE_READ_URL: 'https://read.example' }) ?? '', /never both/);
});

test('anything but exactly "on" fails rather than being guessed at', () => {
  for (const v of ['true', 'yes', 'ON', 'on ', '1']) assert.notEqual(sampleSwitchProblem({ VITE_SAMPLE_DATA: v }), null, v);
});
