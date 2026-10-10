/**
 * WHAT THE JUDGE LOOKED AT, and the one thing it must never do: judge a video it could not
 * see as if it had read text. The old build gave that case a fixed 0.4; here it is an absent
 * judgement, never sent and never paid for, and QUALIFY abstains on it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { storyId } from '@insidor/contracts/ids.ts';
import type { Budget } from '@insidor/contracts/ports/meter.ts';
import type { JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import type { MediaRef } from '@insidor/contracts/vocabulary.ts';
import { inMemoryMeter } from '@insidor/meter';

import type { JudgeClient } from './client.ts';
import { NO_FRAME, anthropicJudge, lookedAtFor, toOutcomes } from './index.ts';

const AT = 1_800_000_000_000;
const CTX = { judgeId: 'judge:test@0', promptId: 'coinability@0', judgedAt: AT, costUsdPerSubject: 0 };
const BUDGET: Budget = { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: AT + 60_000 };

const media = (kind: MediaRef['kind'], uri: string): MediaRef => ({ kind, uri, width: null, height: null, durationMs: null });
const subject = (token: string, m: readonly MediaRef[] = []): JudgeSubject => ({
  storyId: storyId(token),
  texts: ['the same frog on the porch again'],
  media: m,
  distinctAuthors: 3,
  distinctSources: 1,
});

test('text, or a still image, is judged against the text bar', () => {
  assert.equal(lookedAtFor(subject('a')), 'text');
  assert.equal(lookedAtFor(subject('b', [media('image', 'blob://img')])), 'text');
});

test('a video with a frame to show is judged against the frame bar', () => {
  assert.equal(lookedAtFor(subject('c', [media('video', 'blob://frame')])), 'videoFrame');
});

test('a video with no frame cannot be looked at, and is never judged as text instead', () => {
  assert.equal(lookedAtFor(subject('d', [media('video', '')])), null);
  const [o] = toOutcomes([subject('d', [media('video', '  ')])], [{ storyId: String(storyId('d')), coinable: true, confidence: 0.9 }], CTX);
  assert.deepEqual(o, { kind: 'unavailable', storyId: storyId('d'), detail: NO_FRAME });
});

test('the judgement records what was sent, not what the model claims it saw', () => {
  const [o] = toOutcomes(
    [subject('e', [media('video', 'blob://frame')])],
    [{ storyId: String(storyId('e')), coinable: true, confidence: 0.8, lookedAt: 'text' }],
    CTX,
  );
  assert.equal(o?.kind === 'judged' ? o.judgement.lookedAt : null, 'videoFrame');
});

test('an unseeable video is not sent to the model, and outcomes keep the order asked', async () => {
  const sent: unknown[] = [];
  const client: JudgeClient = {
    judge: async ({ payload }) => {
      sent.push(...(payload as readonly JudgeSubject[]));
      return {
        answers: (payload as readonly JudgeSubject[]).map((s) => ({ storyId: String(s.storyId), coinable: true, proposedName: 'frog', confidence: 0.8 })),
        usage: { inputTokens: 10, outputTokens: 10 },
      };
    },
  };
  const judge = anthropicJudge({
    client,
    meter: inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => AT }),
    now: () => AT,
    maxBatch: 10,
  });
  const asked = [subject('f'), subject('g', [media('video', '')]), subject('h', [media('video', 'blob://frame')])];

  const { value } = await judge.judge(asked, BUDGET);

  assert.deepEqual(sent.map((s) => String((s as JudgeSubject).storyId)), [String(storyId('f')), String(storyId('h'))]);
  assert.deepEqual(value.map((o) => o.kind), ['judged', 'unavailable', 'judged']);
  assert.equal(value[0]?.kind === 'judged' ? value[0].judgement.lookedAt : null, 'text');
  assert.equal(value[2]?.kind === 'judged' ? value[2].judgement.lookedAt : null, 'videoFrame');
});
