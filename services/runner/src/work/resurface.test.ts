/**
 * Resurfacing (Policy.judge.resurface): a post a huge account just shared is judged with the share
 * beside it, never given another post's answer, credited so TRACK re-reads it, and its share noted
 * only after the judge answered; off, a spent cap or an unreadable ledger asks nothing. The
 * 2026-10-26 case is the fixture: @elonmusk's "So beautiful" quote of a 16-day-old video.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Judgement, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId, type ItemId } from '@insidor/contracts/ids.ts';
import type { JudgePort, JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { ResurfaceAsk, SharedOriginal } from '@insidor/store';

import type { Logger } from '../log.ts';
import { memoryLaneLedger } from './lane-ledger.ts';
import { RESURFACE_LANE, judgeShareOf, resurface, shareWords } from './resurface.ts';

const NOW = 1_800_000_000_000 as Millis;
const DAY = 86_400_000;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const X = sourceId('x');

const hello: Item = {
  itemId: itemId(X, '2108694357247480087'),
  source: X,
  sourceItemId: '2108694357247480087',
  origin: 'observed',
  authorKey: authorKey(X, '1587601034339561472'),
  postedAt: NOW - 16 * DAY,
  firstSeenAt: NOW - 60_000,
  lang: 'en',
  text: 'hello, world https://t.co/Y9oMid2l82',
  media: [{ kind: 'video', uri: 'https://pbs.example/hello.jpg' }] as never,
  counters: {} as never,
  fingerprints: [],
  rebroadcastOf: null,
  reproductionOf: null,
  formatIds: [],
  rawRef: 'x/hello',
};

const share: SharedOriginal = {
  item: hello,
  byItemId: 'x:2114612551787147343',
  byAuthorKey: 'x:44196397',
  handle: 'elonmusk',
  followers: 229_000_000,
  words: 'So beautiful https://t.co/abc',
  how: 'quoted',
  sharedAtMs: NOW - 2 * 60_000,
};

const yes: Judgement = {
  judgeId: 'judge:test', promptId: 'post@1', judgedAt: NOW, coinable: true, confidence: 0.82, lookedAt: 'videoFrame',
  proposedName: 'HELLO WORLD', alternateNames: [], subjectSpans: [], rationaleRef: null, costUsd: 0.0005,
};

const meter = { record: () => undefined, spentUsd: () => 0, mayspend: () => true, line: () => ({ capUsd: 1, spentUsd: 0, stopAtUsd: 1, remainingUsd: 1, unrecordedUsd: 0 }) } as unknown as Meter;

function deps(over: { found?: readonly SharedOriginal[]; ledger?: ReturnType<typeof memoryLaneLedger> | null; policy?: typeof DEFAULT_POLICY; answers?: boolean } = {}) {
  const sent: JudgeSubject[][] = [];
  const recorded = new Map<ItemId, Judgement>();
  const credited: { ids: readonly ItemId[]; lane: string }[] = [];
  const noted: ResurfaceAsk[] = [];
  let reuseAsked = 0;
  const judge: JudgePort = {
    id: 'judge:test',
    promptId: 'post@1',
    maxBatch: 5,
    estimate: (s) => ({ vendor: 'test', usd: s.length * 0.0005 }) as never,
    judge: async (subjects) => {
      sent.push([...subjects]);
      return over.answers === false
        ? { value: subjects.map((s) => ({ kind: 'unavailable' as const, storyId: s.storyId, detail: 'down' })), spend: { usd: 0 } as never }
        : { value: subjects.map(() => ({ kind: 'judged' as const, judgement: yes })), spend: { usd: subjects.length * 0.0005 } as never };
    },
  };
  const ledger = over.ledger === undefined ? memoryLaneLedger() : over.ledger;
  return {
    sent, recorded, credited, noted, ledger, reuseAsked: () => reuseAsked,
    run: resurface({
      judge,
      items: {
        sharedOriginals: async () => over.found ?? [share],
        markFoundBy: async (ids: readonly ItemId[], lane: string) => void credited.push({ ids, lane }),
      },
      scores: {
        record: async (id: ItemId, j: Judgement) => void recorded.set(id, j),
        recordCopy: async () => assert.fail('a shared post is never given a copied answer'),
        reusable: async () => {
          reuseAsked += 1;
          /* An answer a reuse would have handed it, had it been asked: given without the share. */
          return { byItem: new Map(), byImage: new Map([['https://pbs.example/hello.jpg', { sourceId: itemId(X, 'other'), judgement: { ...yes, coinable: false } }]]) } as never;
        },
      },
      shares: { record: async (asks: readonly ResurfaceAsk[]) => (noted.push(...asks), asks.length) },
      ledger: ledger ?? { spent: async () => null, add: async () => undefined },
      wordsSha: 'abcd1234',
      meter,
      mode: 'live',
      policy: over.policy ?? DEFAULT_POLICY,
      log: quiet,
      now: () => NOW,
    }),
  };
}

test('the 2026-10-26 case: the 16-day-old video is judged with Elon\'s quote beside it, credited, and its share noted', async () => {
  const d = deps();
  const r = await d.run();
  assert.equal(r.found, 1);
  assert.equal(d.sent.length, 1);
  assert.deepEqual(d.sent[0]?.[0]?.sharedBy, { handle: 'elonmusk', followers: 229_000_000, how: 'quoted', words: 'So beautiful' });
  assert.equal(d.recorded.get(hello.itemId)?.coinable, true, 'filed like any answer');
  assert.deepEqual(d.credited, [{ ids: [hello.itemId], lane: 'quoted' }]);
  assert.equal(d.noted.length, 1);
  assert.equal(d.noted[0]?.byItemId, 'x:2114612551787147343');
  assert.equal(d.noted[0]?.sharedAt.getTime(), NOW - 2 * 60_000);
  assert.equal(d.noted[0]?.wordsSha, 'abcd1234');
  assert.deepEqual([...(d.ledger?.totals.entries() ?? [])].map(([k, v]) => [k.split(':')[1], v]), [[RESURFACE_LANE, 0.0005]], 'charged to its own lane');
});

test('no other post\'s answer is reused for a shared post: that answer never saw the share', async () => {
  const d = deps();
  await d.run();
  assert.equal(d.sent.length, 1, 'asked, not copied');
});

test('off, a spent cap, or an unreadable ledger: nothing is read or asked', async () => {
  const off = deps({ policy: { ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, resurface: { ...DEFAULT_POLICY.judge.resurface, on: false } } } });
  assert.equal((await off.run()).held, 'off');
  const capped = deps({ ledger: memoryLaneLedger({ [RESURFACE_LANE]: DEFAULT_POLICY.judge.resurface.dailyUsd }) });
  assert.equal((await capped.run()).held, 'cap');
  const unread = deps({ ledger: null });
  assert.equal((await unread.run()).held, 'ledger');
  for (const d of [off, capped, unread]) assert.equal(d.sent.length, 0);
});

test('a share with no handle we could name is not asked about', async () => {
  const d = deps({ found: [{ ...share, handle: null }] });
  const r = await d.run();
  assert.equal(r.found, 0);
  assert.equal(d.sent.length, 0);
});

test('the share\'s words: links dropped, space folded, clipped', () => {
  assert.equal(shareWords('So   beautiful\nhttps://t.co/x ', 100), 'So beautiful');
  assert.equal(shareWords('abcdef', 3), 'abc');
  assert.deepEqual(judgeShareOf({ ...share, handle: '@elonmusk', how: 'samePicture', words: 'https://t.co/only' }, 100), { handle: 'elonmusk', followers: 229_000_000, how: 'samePicture', words: '' });
});
