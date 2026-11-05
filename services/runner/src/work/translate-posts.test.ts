/**
 * The translate step: what it sends, what it writes without asking, and that off, dry and a
 * failed call write nothing a later pass would mistake for "nothing to translate".
 */

import { strict as assert } from 'node:assert';
import { beforeEach, test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { TranslateOutcome, TranslatePort, TranslateSubject } from '@insidor/contracts/ports/translate.ts';
import type { TranslateCandidate, TranslationRow } from '@insidor/store';

import { createLogger } from '../log.ts';
import { NO_WORDS_PROMPT, forgetTranslateFailures, retryAfterMs, translatePosts, wordsToTranslate } from './translate-posts.ts';

beforeEach(() => forgetTranslateFailures());

const meter = { line: () => ({ capUsd: 1, spentUsd: 0 }) } as unknown as Meter;
const log = createLogger({ test: 'translate-posts' });
const on: Policy = { ...DEFAULT_POLICY, translate: { ...DEFAULT_POLICY.translate, on: true } };

function setup(due: TranslateCandidate[], answer: (s: TranslateSubject) => TranslateOutcome) {
  const asked: TranslateSubject[] = [];
  const written: TranslationRow[] = [];
  const translator: TranslatePort = {
    id: 't', promptId: 'translate@abc', model: 'm',
    async translate(subjects) {
      asked.push(...subjects);
      return { value: subjects.map(answer), spend: { vendor: 'v', endpoint: 'translate', units: 1, usd: 0.001, at: 0 as Millis } } as never;
    },
  };
  const translations = { candidates: async () => due, put: async (rows: readonly TranslationRow[]) => (written.push(...rows), true) };
  return { asked, written, deps: { translator, translations, meter, mode: 'live' as const, policy: on, log, now: () => 0 as Millis } };
}

test('English and hashtag-only posts are written without asking; the rest are asked once', async () => {
  const s = setup(
    [
      { itemId: 'x:1', text: 'hello there', lang: 'en' },
      { itemId: 't:2', text: '#Meme #MemeCut ', lang: null },
      { itemId: 'x:3', text: 'o rato caiu https://t.co/abc', lang: 'pt' },
      { itemId: 't:4', text: 'Cute haa 😚', lang: 'so' },
    ],
    (x) => (x.ref === 'x:3' ? { kind: 'translated', ref: x.ref, from: 'pt', text: 'the rat fell' } : { kind: 'kept', ref: x.ref, from: 'en' }),
  );
  const r = await translatePosts(s.deps);
  assert.deepEqual(s.asked.map((a) => a.text), ['o rato caiu', 'Cute haa 😚']);
  assert.deepEqual(r, { skipped: null, due: 4, translated: 1, kept: 3, absent: 0, usd: 0.001 });
  assert.deepEqual(s.written.find((w) => w.itemId === 'x:1'), { itemId: 'x:1', from: 'en', textEn: null, model: null, promptId: NO_WORDS_PROMPT });
  assert.deepEqual(s.written.find((w) => w.itemId === 't:2')?.from, 'zxx');
  assert.deepEqual(s.written.find((w) => w.itemId === 'x:3'), { itemId: 'x:3', from: 'pt', textEn: 'the rat fell', model: 'm', promptId: 'translate@abc' });
  assert.deepEqual(s.written.find((w) => w.itemId === 't:4'), { itemId: 't:4', from: 'en', textEn: null, model: 'm', promptId: 'translate@abc' });
});

test('a post with no answer writes nothing, so the next pass asks again', async () => {
  const s = setup([{ itemId: 'x:3', text: 'o rato caiu', lang: 'pt' }], (x) => ({ kind: 'absent', ref: x.ref, detail: 'down' }));
  const r = await translatePosts(s.deps);
  assert.equal(r.absent, 1);
  assert.equal(s.written.length, 0);
});

test('off, or a dry run, asks nobody and writes nothing', async () => {
  const s = setup([{ itemId: 'x:3', text: 'o rato caiu', lang: 'pt' }], (x) => ({ kind: 'kept', ref: x.ref, from: 'en' }));
  const off = { ...DEFAULT_POLICY, translate: { ...DEFAULT_POLICY.translate, on: false } };
  assert.match((await translatePosts({ ...s.deps, policy: off })).skipped ?? '', /switched off/);
  assert.match((await translatePosts({ ...s.deps, mode: 'dry' })).skipped ?? '', /dry/);
  assert.equal(s.asked.length + s.written.length, 0);
});

test('the words sent drop the trailing short links the card drops, and are cut to the cap', () => {
  assert.equal(wordsToTranslate('VAI LOGO! https://t.co/Vnd434AexJ', 600), 'VAI LOGO!');
  assert.equal(wordsToTranslate('ver https://t.co/a no meio', 600), 'ver https://t.co/a no meio');
  assert.equal(wordsToTranslate('ábcdé', 3), 'ábc');
});

test('★ a post that fails is asked alone next time and waits longer after each failure, and never sinks the others', async () => {
  let now = 0;
  const due: TranslateCandidate[] = [{ itemId: 'x:bad', text: 'ㅋㅋㅋㅋㅋㅋ', lang: 'ko' }, { itemId: 'x:ok', text: 'o rato caiu', lang: 'pt' }];
  const calls: string[][] = [];
  const s = setup(due, (x) => (x.ref === 'x:bad' ? { kind: 'absent', ref: x.ref, detail: 'length' } : { kind: 'translated', ref: x.ref, from: 'pt', text: 'the rat fell' }));
  const askedBefore = s.deps.translator.translate.bind(s.deps.translator);
  const deps = { ...s.deps, now: () => now as Millis, translator: { ...s.deps.translator, translate: async (subjects: readonly TranslateSubject[], b: never) => (calls.push(subjects.map((x) => x.ref)), askedBefore(subjects, b)) } };
  const first = await translatePosts(deps);
  assert.equal(first.absent, 1);
  assert.deepEqual(calls, [['x:bad', 'x:ok']]);
  /* Within its wait: not asked at all. */
  now = retryAfterMs(1) - 1;
  calls.length = 0;
  await translatePosts(deps);
  assert.deepEqual(calls, [['x:ok']]);
  /* After its wait: asked on its own call, and its next wait is longer. */
  now = retryAfterMs(1);
  calls.length = 0;
  await translatePosts(deps);
  assert.deepEqual(calls, [['x:ok'], ['x:bad']]);
  assert.ok(retryAfterMs(2) > retryAfterMs(1));
  assert.equal(retryAfterMs(20), 21_600_000, 'never more than six hours');
});

/* ★ THE ECHO'S SECOND OPINION (policy.v228, 2026-11-05): "A si como trates a este Perrito…" came back
   as itself, read as Spanish, and was stored as nothing to translate. */
function withEcho(due: TranslateCandidate[], first: (s: TranslateSubject) => TranslateOutcome, second: ((s: TranslateSubject) => TranslateOutcome) | 'throws') {
  const s = setup(due, first);
  const echoAsked: TranslateSubject[] = [];
  const echoTranslator: TranslatePort = {
    id: 'e', promptId: 'translate@abc', model: 'gemma',
    async translate(subjects) {
      echoAsked.push(...subjects);
      if (second === 'throws') throw new Error('router down');
      return { value: subjects.map(second), spend: { vendor: 'v', endpoint: 'translate', units: 1, usd: 0.0001, at: 0 as Millis } } as never;
    },
  };
  return { ...s, echoAsked, deps: { ...s.deps, echoTranslator } };
}

test('★ a post echoed in another language is put to the second model alone, and its English kept', async () => {
  const s = withEcho(
    [
      { itemId: 'x:1', text: 'A si como trates a este Perrito', lang: 'es' },
      { itemId: 'x:2', text: 'o rato caiu', lang: 'pt' },
      { itemId: 'x:3', text: 'Eu/acc vibes', lang: 'pt' },
    ],
    (x) => (x.ref === 'x:2' ? { kind: 'translated', ref: x.ref, from: 'pt', text: 'the rat fell' } : x.ref === 'x:1' ? { kind: 'kept', ref: x.ref, from: 'es' } : { kind: 'kept', ref: x.ref, from: 'en' }),
    (x) => ({ kind: 'translated', ref: x.ref, from: 'es', text: 'As you treat this little dog' }),
  );
  const r = await translatePosts(s.deps);
  assert.deepEqual(s.echoAsked.map((a) => a.ref), ['x:1'], 'only the echo; a post read as English is not');
  assert.deepEqual(s.written.find((w) => w.itemId === 'x:1'), { itemId: 'x:1', from: 'es', textEn: 'As you treat this little dog', model: 'gemma', promptId: 'translate@abc' });
  assert.deepEqual(s.written.find((w) => w.itemId === 'x:3')?.textEn, null);
  assert.deepEqual(r, { skipped: null, due: 3, translated: 2, kept: 1, absent: 0, echoFixed: 1, usd: 0.0011 });
});

test('a second model that echoes too, or fails, leaves the row as the first model answered', async () => {
  for (const second of [((x: TranslateSubject) => ({ kind: 'kept', ref: x.ref, from: 'es' })) as (s: TranslateSubject) => TranslateOutcome, 'throws' as const]) {
    forgetTranslateFailures();
    const s = withEcho([{ itemId: 'x:1', text: 'mira que dependen de ustedes', lang: 'es' }], (x) => ({ kind: 'kept', ref: x.ref, from: 'es' }), second);
    const r = await translatePosts(s.deps);
    assert.deepEqual(s.written, [{ itemId: 'x:1', from: 'es', textEn: null, model: 'm', promptId: 'translate@abc' }]);
    assert.equal(r.echoFixed, 0);
    assert.equal(r.kept, 1);
  }
});

test('no echo, no second call', async () => {
  const s = withEcho([{ itemId: 'x:2', text: 'o rato caiu', lang: 'pt' }], (x) => ({ kind: 'translated', ref: x.ref, from: 'pt', text: 'the rat fell' }), () => assert.fail('asked'));
  await translatePosts(s.deps);
  assert.equal(s.echoAsked.length, 0);
});
