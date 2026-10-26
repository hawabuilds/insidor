/**
 * The viral exception's pass: only huge, fast, turned-down posts are asked; a moment "yes" meets the
 * kind question and both answers are written; a near match to the owner's "not a meme" is a no by
 * rule; an outage writes nothing; and the day's cap and an unreadable ledger ask nothing.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Judgement, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId, type ItemId } from '@insidor/contracts/ids.ts';
import type { JudgeOutcome, JudgePort, JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { ViralDue, ViralRecord } from '@insidor/store';

import type { Logger } from '../log.ts';
import { memoryLaneLedger } from './lane-ledger.ts';
import { VIRAL_LANE, viralMoments, viralSubject } from './viral-moments.ts';

const NOW = 1_800_000_000_000 as Millis;
const MIN = 60_000;
const P = DEFAULT_POLICY;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const meter = { record: () => undefined, spentUsd: () => 0, mayspend: () => true, line: () => ({ capUsd: 1, spentUsd: 0, stopAtUsd: 1, remainingUsd: 1, unrecordedUsd: 0 }) } as unknown as Meter;

function post(n: number, text: string): Item {
  const source = sourceId('x');
  return {
    itemId: itemId(source, `${n}`), source, sourceItemId: `${n}`, origin: 'observed', authorKey: authorKey(source, `a${n}`),
    postedAt: NOW - 50 * MIN, firstSeenAt: NOW - 49 * MIN, lang: 'en', text, media: [], counters: {} as never,
    fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: `x/${n}`,
  };
}

const judgement = (over: Partial<Judgement>): Judgement => ({
  judgeId: 'judge:test', promptId: 'p@1', judgedAt: NOW, coinable: false, confidence: 0.9, lookedAt: 'text',
  proposedName: null, alternateNames: [], subjectSpans: [], rationaleRef: null, costUsd: 0, ...over,
});

/** A judge that answers each post by its text; `down` answers nothing. */
function fakeJudge(id: string, answer: (s: JudgeSubject) => Judgement | null) {
  const sent: string[][] = [];
  const judge: JudgePort = {
    id,
    promptId: `${id}@1`,
    maxBatch: 10,
    estimate: (s) => ({ vendor: 'test', usd: s.length * 0.0003 }) as never,
    judge: async (subjects) => {
      sent.push(subjects.map((s) => s.texts[0] ?? ''));
      const value: JudgeOutcome[] = subjects.map((s) => {
        const a = answer(s);
        return a === null ? { kind: 'unavailable', storyId: s.storyId, detail: 'down' } : { kind: 'judged', judgement: a };
      });
      return { value, spend: { usd: subjects.length * 0.0003 } as never };
    },
  };
  return { judge, sent };
}

const POSTS = [post(1, 'Trump says Nicki Minaj has a beautiful a**'), post(2, 'influencer found dead in Monterrey'), post(3, 'slow but big'), post(4, 'held as sport')];
/* Views: 1 and 2 huge and fast; 3 big but slow (5k a minute); 4 huge but held as SPORT. */
const READS: Record<string, { atMs: number; reach: number }[]> = {
  'x:1': [{ atMs: NOW, reach: 2_000_000 }],
  'x:2': [{ atMs: NOW, reach: 900_000 }],
  'x:3': [{ atMs: NOW - 10 * MIN, reach: 200_000 }],
  'x:4': [{ atMs: NOW, reach: 3_000_000 }],
};
const DUE: ViralDue[] = [
  { itemId: 'x:1', postedAtMs: NOW - 50 * MIN, firstCoinable: false, kindLabel: null },
  { itemId: 'x:2', postedAtMs: NOW - 50 * MIN, firstCoinable: false, kindLabel: null },
  { itemId: 'x:3', postedAtMs: NOW - 50 * MIN, firstCoinable: false, kindLabel: null },
  { itemId: 'x:4', postedAtMs: NOW - 50 * MIN, firstCoinable: true, kindLabel: 'SPORT' },
];

function setup(over: { viral?: ReturnType<typeof fakeJudge>; kind?: ReturnType<typeof fakeJudge> | null; ledger?: ReturnType<typeof memoryLaneLedger>; closestNot?: (id: string) => number | null } = {}) {
  const viral = over.viral ?? fakeJudge('viral', (s) => (s.texts[0]?.includes('Nicki') ? judgement({ coinable: true, confidence: 0.85, proposedName: 'BEAUTIFUL' }) : judgement({ coinable: true, confidence: 0.8, proposedName: 'KOMANCHE' })));
  const kind = over.kind === undefined ? fakeJudge('kind', (s) => judgement({ proposedName: s.texts[0]?.includes('dead') ? 'TRAGEDY' : 'POLITICS' })) : over.kind;
  const written: ViralRecord[] = [];
  const ledger = over.ledger ?? memoryLaneLedger();
  const run = viralMoments({
    viralJudge: viral.judge,
    kindJudge: kind === null ? null : kind.judge,
    repo: { due: async () => DUE, record: async (r) => void written.push(r) },
    items: {
      reachReadings: async (ids: readonly ItemId[]) => new Map(ids.map((id) => [String(id), READS[String(id)] ?? []])),
      byIds: async (ids: readonly ItemId[]) => new Map(POSTS.filter((p) => ids.includes(p.itemId)).map((p) => [p.itemId, p] as const)),
    },
    precedents: over.closestNot === undefined ? null : { forPosts: async (items: readonly Item[]) => new Map(items.map((i) => [String(i.itemId), { precedents: [], closestNot: over.closestNot!(String(i.itemId)), closestNotId: null }] as const)) },
    ledger,
    meter,
    mode: 'live',
    policy: P,
    log: quiet,
    now: () => NOW,
  });
  return { run, viral, kind, written, ledger };
}

test('★ only the huge, fast, turned-down posts are asked; a moment meets the kind question and both are written', async () => {
  const s = setup();
  const r = await s.run();
  assert.deepEqual(s.viral.sent, [['Trump says Nicki Minaj has a beautiful a**', 'influencer found dead in Monterrey']], 'not the slow post, not the sport hold');
  assert.equal(s.kind?.sent.length, 1);
  const byId = new Map(s.written.map((w) => [w.itemId, w] as const));
  assert.deepEqual([byId.get('x:1')?.moment, byId.get('x:1')?.name, byId.get('x:1')?.kind], [true, 'BEAUTIFUL', 'POLITICS']);
  assert.deepEqual([byId.get('x:2')?.moment, byId.get('x:2')?.kind], [true, 'TRAGEDY'], 'written as the kind said: the projector keeps a tragedy off');
  assert.equal(r.moments, 1, 'only the passing kind counts as a moment let through');
  assert.ok(r.spentUsd > 0);
  assert.equal(await s.ledger.spent(VIRAL_LANE, NOW), r.spentUsd, 'charged to its lane');
});

test('a "no" moment is written without asking the kind', async () => {
  const s = setup({ viral: fakeJudge('viral', () => judgement({ coinable: false, confidence: 0.9 })) });
  await s.run();
  assert.equal(s.kind?.sent.length, 0);
  assert.deepEqual(s.written.map((w) => [w.itemId, w.moment, w.kind]), [['x:1', false, null], ['x:2', false, null]]);
});

test("★ a near match to the owner's 'not a meme' is a no by rule, never asked", async () => {
  const s = setup({ closestNot: (id) => (id === 'x:1' ? 0.99 : 0.1) });
  await s.run();
  assert.deepEqual(s.viral.sent, [['influencer found dead in Monterrey']]);
  const rule = s.written.find((w) => w.itemId === 'x:1');
  assert.deepEqual([rule?.moment, rule?.kind, rule?.costUsd], [false, 'NOT_MEME_MATCH', 0]);
});

test('★ no answer is not a no: an outage writes nothing; a moment whose kind reply named none is kept with its kind empty', async () => {
  const down = setup({ viral: fakeJudge('viral', () => null) });
  await down.run();
  assert.equal(down.written.length, 0, 'asked again next pass');
  const noKind = setup({ kind: fakeJudge('kind', () => null) });
  const r = await noKind.run();
  assert.deepEqual(noKind.written.map((w) => [w.itemId, w.moment, w.kind, w.kindAsks]), [['x:1', true, null, 1], ['x:2', true, null, 1]], 'the moment is not paid for again');
  assert.equal(r.moments, 0);
  const kindless = setup({ kind: null });
  await kindless.run();
  assert.deepEqual(kindless.written.map((w) => [w.kind, w.kindAsks]), [[null, 0], [null, 0]]);
});

test('★ the kind catch-up asks the kind alone again of a moment left unnamed, and counts the ask', async () => {
  const kind = fakeJudge('kind', () => judgement({ proposedName: 'POLITICS' }));
  const viral = fakeJudge('viral', () => judgement({ coinable: true, confidence: 0.9, proposedName: 'X' }));
  const kinds: [string, string | null][] = [];
  const run = viralMoments({
    viralJudge: viral.judge,
    kindJudge: kind.judge,
    repo: { due: async () => [], record: async () => undefined, kindDue: async () => ['x:1'], recordKind: async (id, a) => void kinds.push([id, a?.kind ?? null]) },
    items: { reachReadings: async () => new Map(), byIds: async (ids: readonly ItemId[]) => new Map(POSTS.filter((p) => ids.includes(p.itemId)).map((p) => [p.itemId, p] as const)) },
    ledger: memoryLaneLedger(), meter, mode: 'live', policy: P, log: quiet, now: () => NOW,
  });
  const r = await run();
  assert.deepEqual(kinds, [['x:1', 'POLITICS']]);
  assert.equal(viral.sent.length, 0, 'the moment is not asked again');
  assert.ok(r.spentUsd > 0);
});

test("the day's cap and an unreadable ledger ask nothing; off asks nothing", async () => {
  const capped = setup({ ledger: memoryLaneLedger({ viral: P.judge.viral.dailyUsd }) });
  assert.equal((await capped.run()).held, 'cap');
  assert.equal(capped.viral.sent.length, 0);
  const blind = setup({ ledger: { ...memoryLaneLedger(), spent: async () => null } as never });
  assert.equal((await blind.run()).held, 'ledger');
  const off = viralMoments({
    viralJudge: fakeJudge('viral', () => null).judge, kindJudge: null, repo: { due: async () => DUE, record: async () => undefined },
    items: { reachReadings: async () => new Map(), byIds: async () => new Map() }, ledger: memoryLaneLedger(), meter, mode: 'live',
    policy: { ...P, judge: { ...P.judge, viral: { ...P.judge.viral, on: false } } }, log: quiet, now: () => NOW,
  });
  assert.equal((await off()).held, 'off');
});

test('★ a quote with no picture of its own is shown with the post it quotes', () => {
  const quoted = { ...post(9, 'hello, world'), media: [{ uri: 'https://pic/1.jpg', kind: 'image' }] as never };
  const elon = { ...post(8, 'So beautiful'), reproductionOf: quoted.itemId };
  const s = viralSubject(elon, quoted, P);
  assert.deepEqual(s.texts, ['So beautiful', 'Quoting: hello, world']);
  assert.equal(s.media, quoted.media);
  const own = { ...elon, media: [{ uri: 'https://pic/2.jpg', kind: 'image' }] as never };
  assert.deepEqual(viralSubject(own, quoted, P).texts, ['So beautiful'], 'its own picture: shown as itself');
});
