import { test } from 'node:test';
import assert from 'node:assert/strict';

import { markPassed, passedSteps, progressOf, stepsLeft, type StepFacts } from './flow.ts';
import { askable, cleanUsername, localProblem, typed } from './username.ts';
import { clamp, sourceSquare, START } from './crop.ts';

test('★ the crop always covers the round window, and uploads the square it shows', () => {
  /* A 400x200 picture under a 100px window: at zoom 1 the short side fills it. */
  assert.deepEqual(sourceSquare(START, 400, 200, 100), { sx: 100, sy: 0, size: 200 });
  assert.deepEqual(clamp({ zoom: 1, x: 500, y: 40 }, 400, 200, 100), { zoom: 1, x: 50, y: 0 }, 'moved no further than the picture reaches');
  assert.deepEqual(sourceSquare({ zoom: 1, x: 50, y: 0 }, 400, 200, 100), { sx: 0, sy: 0, size: 200 }, 'dragged right shows the left edge');
  assert.deepEqual(clamp({ zoom: 9, x: 0, y: 0 }, 400, 200, 100).zoom, 4);
  assert.deepEqual(clamp({ zoom: 0.2, x: 0, y: 0 }, 400, 200, 100).zoom, 1, 'never smaller than the window');
  const z = sourceSquare({ zoom: 2, x: 0, y: 0 }, 400, 200, 100);
  assert.deepEqual(z, { sx: 150, sy: 50, size: 100 }, 'zoomed in, a smaller square from the middle');
});

const fresh: StepFacts = { handleChosen: false, pictureChosen: false, passed: [], iosSafariTab: false, alertsAskable: false };

test('★ the order: username, photo, Add to Home Screen, alerts, done — done always last', () => {
  assert.deepEqual(stepsLeft({ ...fresh, iosSafariTab: true, alertsAskable: true }), ['username', 'photo', 'home', 'alerts', 'done']);
  assert.deepEqual(stepsLeft(fresh), ['username', 'photo', 'done'], 'no Home Screen outside iPhone Safari, no alerts where they cannot be asked');
  assert.deepEqual(stepsLeft({ ...fresh, handleChosen: true, pictureChosen: true }), ['done']);
});

test('★ a member skips what they already did: a chosen name, a chosen photo, a step passed on this phone', () => {
  assert.deepEqual(stepsLeft({ ...fresh, handleChosen: true }), ['photo', 'done']);
  assert.deepEqual(stepsLeft({ ...fresh, passed: ['photo', 'home', 'alerts'], iosSafariTab: true, alertsAskable: true }), ['username', 'done']);
  assert.deepEqual(stepsLeft({ ...fresh, passed: ['username'] }), ['username', 'photo', 'done'], 'a username is never passed on the phone alone: the server holds it');
});

test('the progress line is a quarter a screen on the four that draw it, and none after', () => {
  assert.deepEqual((['methods', 'code', 'username', 'photo'] as const).map(progressOf), [0.25, 0.5, 0.75, 1]);
  assert.deepEqual((['welcome', 'home', 'alerts', 'done'] as const).map(progressOf), [null, null, null, null]);
});

test('steps passed are kept on the phone; a broken store reads as none', () => {
  const kept = new Map<string, string>();
  const store = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
  markPassed(store, 'photo');
  markPassed(store, 'photo');
  markPassed(store, 'alerts');
  assert.deepEqual(passedSteps(store), ['photo', 'alerts']);
  assert.deepEqual(passedSteps({ getItem: () => '{nope', setItem: () => undefined }), []);
  assert.deepEqual(passedSteps(null), []);
});

test('★ username rules as the server has them: 3 to 15 letters, numbers or _, lower case, no @', () => {
  assert.equal(cleanUsername(' @Hawa_ '), 'hawa_');
  assert.equal(typed('@Ha wa.X!'), 'hawax', 'the box keeps only what a name can hold');
  assert.equal(typed('abcdefghijklmnopq'), 'abcdefghijklmno', 'and no more than 15');
  assert.equal(askable('ha'), false, 'too short to ask about');
  assert.equal(askable('haw'), true);
  assert.equal(localProblem('ha wa'), 'Only letters, numbers and _.');
  assert.equal(localProblem('a_very_long_name'), 'Up to 15 characters.');
});

test('a sign-up reply is read field by field: no number is 0, no picture is anything but a link', async () => {
  const { decodeNameCheck, decodeStatus } = await import('../../shared/api/onboarding.ts');
  const s = decodeStatus({ handle: 'hawa', handleChosen: true, memberNo: 0, invitesLeft: 3, pictureUrl: 'javascript:alert(1)', done: 'yes' });
  assert.deepEqual([s.handle, s.handleChosen, s.memberNo, s.invitesLeft, s.pictureUrl, s.done], ['hawa', true, null, 3, null, false]);
  assert.equal(decodeStatus({ memberNo: 213 }).memberNo, 213);
  const c = decodeNameCheck({ name: 'hawa', state: 'taken', suggestions: ['hawa_', 'BAD NAME', 'hawa1'] });
  assert.deepEqual([c.state, c.suggestions], ['taken', ['hawa_', 'hawa1']]);
  assert.equal(decodeNameCheck({ state: 'weird' }).state, 'invalid');
});
