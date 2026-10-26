/** The viral exception: who is asked, the huge-and-fast bar on the owner's two missed posts, and which answers pass. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { clearsViralBar, passesAsViral, viralEligible, type ViralAnswer } from './viral.ts';

const P = DEFAULT_POLICY;
const OFF = { ...P, judge: { ...P.judge, viral: { ...P.judge.viral, on: false } } };
const MIN = 60_000;
const at = (iso: string): number => Date.parse(iso);

test('a "no", or a politics or showbiz hold, is eligible; a yes, an unjudged post and every other hold are not', () => {
  assert.equal(viralEligible(false, null, P), true);
  assert.equal(viralEligible(true, 'POLITICS', P), true);
  assert.equal(viralEligible(true, 'showbiz', P), true, 'the label as the model may case it');
  assert.equal(viralEligible(true, null, P), false, 'a yes needs no exception');
  assert.equal(viralEligible(null, null, P), false, 'never judged');
  for (const k of ['AD', 'SPORT', 'FANDOM', 'NOT_MEME_MATCH']) assert.equal(viralEligible(false, k, P), false, `${k} is never lifted`);
  assert.equal(viralEligible(false, null, OFF), false, 'off: nothing');
});

test("★ the owner's two misses clear the bar on the readings we had", () => {
  /* @PopBase, Trump on Nicki Minaj: posted 20:43:24, read at +3, +6 and +301 minutes. */
  const trumpPosted = at('2026-10-25T20:43:24Z');
  const trump = [
    { atMs: at('2026-10-25T20:46:46Z'), reach: 18_752 },
    { atMs: at('2026-10-25T20:49:33Z'), reach: 26_665 },
    { atMs: at('2026-10-26T01:44:19Z'), reach: 2_961_444 },
  ];
  assert.equal(clearsViralBar(trump, trumpPosted, P), true);
  assert.equal(clearsViralBar(trump.slice(0, 2), trumpPosted, P), false, 'not on its first two readings');
  /* @elonmusk, "So beautiful": posted 06:58:14, 590k at +51 minutes. */
  const elonPosted = at('2026-10-26T06:58:14Z');
  const elon = [
    { atMs: at('2026-10-26T07:03:03Z'), reach: 313_903 },
    { atMs: at('2026-10-26T07:06:43Z'), reach: 357_201 },
    { atMs: at('2026-10-26T07:49:43Z'), reach: 589_719 },
  ];
  assert.equal(clearsViralBar(elon, elonPosted, P), true);
  assert.equal(clearsViralBar(elon.slice(0, 2), elonPosted, P), false, 'under 500k it is not huge yet');
});

test('slow, late, unread or undated is not huge and fast', () => {
  const posted = 1_800_000_000_000;
  assert.equal(clearsViralBar([{ atMs: posted + 120 * MIN, reach: 600_000 }], posted, P), false, '5k a minute is slow');
  assert.equal(clearsViralBar([{ atMs: posted + 400 * MIN, reach: 9_000_000 }], posted, P), false, 'past six hours');
  assert.equal(clearsViralBar([{ atMs: posted + 10 * MIN, reach: null }], posted, P), false);
  assert.equal(clearsViralBar([{ atMs: posted + 10 * MIN, reach: 900_000 }], null, P), false);
  assert.equal(clearsViralBar([{ atMs: posted + 10 * MIN, reach: 900_000 }], posted, P), true);
});

const YES: ViralAnswer = { moment: true, confidence: 0.85, name: 'BEAUTIFUL', kind: 'SHOWBIZ' };

test('a sure moment with a short name and a passing kind passes', () => {
  assert.equal(passesAsViral(YES, P), true);
  assert.equal(passesAsViral({ ...YES, kind: 'POLITICS' }, P), true);
  assert.equal(passesAsViral({ ...YES, kind: 'other' }, P), true);
});

test('★ a tragedy, company news or any kind outside the list never passes, whatever the moment said', () => {
  for (const kind of ['TRAGEDY', 'CORP_NEWS', 'MEDIA_NEWS', 'SPORT', 'AD', 'FANDOM', 'NOT_MEME_MATCH']) assert.equal(passesAsViral({ ...YES, kind }, P), false, kind);
  assert.equal(passesAsViral({ ...YES, kind: null }, P), false, 'no kind answer yet: it waits');
});

test('a "no", an unsure yes, a long or missing name, no answer, or the switch off: no', () => {
  assert.equal(passesAsViral({ ...YES, moment: false }, P), false);
  assert.equal(passesAsViral({ ...YES, confidence: 0.5 }, P), false);
  assert.equal(passesAsViral({ ...YES, name: 'a very long moment name' }, P), false);
  assert.equal(passesAsViral({ ...YES, name: null }, P), false);
  assert.equal(passesAsViral(null, P), false);
  assert.equal(passesAsViral(YES, OFF), false);
});
