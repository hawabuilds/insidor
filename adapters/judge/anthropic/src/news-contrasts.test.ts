/**
 * THE NEWS RULES, HELD IN PLACE.
 *
 * Mercury's prompts never mentioned news, politics or sport results, and that was the main
 * thing the old meme-score prompt did better. These tests exist so that a later prompt edit
 * which quietly drops a news rule fails here rather than in a week of wrong judgements.
 *
 * ★ WHAT THEY CAN AND CANNOT CATCH. Each case in `fixtures/news-contrasts.json` names the
 * prompt lines that teach its answer, and the first test fails if any of those lines is
 * deleted or reworded. They CANNOT catch a rewording the model reads differently — that needs
 * real recorded answers, and the judge client has never made a call. The fixture's `answer`
 * fields are hand-written in the judge's format and say so (`answerSource`). The follow-up is
 * in docs/meme-score-comparison.md: one small recorded live run of every case, swapped in here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { storyId } from '@insidor/contracts/ids.ts';
import type { JudgeSubject } from '@insidor/contracts/ports/judge.ts';

import { PROMPTS } from './prompts.ts';
import { toOutcomes } from './to-judgement.ts';

interface Case {
  readonly id: string;
  readonly side: 'news' | 'subject';
  readonly pair?: string;
  readonly texts: readonly string[];
  readonly expect: { readonly coinable: boolean };
  readonly promptMustContain: readonly string[];
  readonly answerSource: 'hand-written' | 'recorded';
  readonly answer: Record<string, unknown>;
}

const FIXTURE = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'news-contrasts.json'), 'utf8'),
) as { readonly cases: readonly Case[] };
const CASES = FIXTURE.cases;

/** Everything the model is sent, as one string, the way index.ts sends it. */
const SENT = [PROMPTS.system.text, PROMPTS['coinability-core'].text, PROMPTS['subject-vs-story'].text].join('\n\n');
/** Line breaks in the prompt files are layout, not meaning. */
const flat = (s: string): string => s.replace(/\s+/g, ' ');

const CTX = { judgeId: 'judge:test@0', promptId: 'coinability@0', judgedAt: 1_800_000_000_000, costUsdPerSubject: 0 };

test('every contrast the fixtures rely on is still taught by the prompts', () => {
  for (const c of CASES) {
    for (const line of c.promptMustContain) {
      assert.ok(flat(SENT).includes(flat(line)), `${c.id}: the prompts no longer contain "${line}"`);
    }
  }
});

test('news is named as "no subject" in the core instructions, not only in examples', () => {
  const core = flat(PROMPTS['coinability-core'].text);
  for (const word of ['NEWS', 'EVENT', 'ARGUMENT', 'match result', 'product or tech announcement', 'transfer news']) {
    assert.ok(core.includes(word), `coinability-core no longer names "${word}"`);
  }
});

test('the paired cases keep both halves, so the model learns the difference and not the name', () => {
  const pairs = new Map<string, Set<string>>();
  for (const c of CASES) {
    if (c.pair === undefined) continue;
    pairs.set(c.pair, (pairs.get(c.pair) ?? new Set()).add(c.side));
  }
  assert.ok(pairs.size >= 3);
  for (const [pair, sides] of pairs) assert.deepEqual([...sides].sort(), ['news', 'subject'], pair);
});

test('every news case expects "not coinable" and every subject case expects "coinable"', () => {
  for (const c of CASES) assert.equal(c.expect.coinable, c.side === 'subject', c.id);
});

test('the fixture answers are labelled for what they are', () => {
  for (const c of CASES) assert.ok(c.answerSource === 'hand-written' || c.answerSource === 'recorded', c.id);
});

test('each answer decodes to the expected judgement, and a news "no" is a judgement, not an absence', () => {
  const subjects: JudgeSubject[] = CASES.map((c) => ({
    storyId: storyId(c.id),
    texts: c.texts,
    media: [],
    distinctAuthors: c.texts.length,
    distinctSources: 1,
  }));
  const outcomes = toOutcomes(subjects, CASES.map((c) => ({ storyId: String(storyId(c.id)), ...c.answer })), CTX);
  outcomes.forEach((o, i) => {
    const c = CASES[i];
    assert.ok(c);
    assert.equal(o.kind, 'judged', `${c.id} came back ${o.kind}`);
    if (o.kind === 'judged') assert.equal(o.judgement.coinable, c.expect.coinable, c.id);
  });
});
