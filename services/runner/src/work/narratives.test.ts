/**
 * The narratives pass against a fake store: who is grouped (the judge's yes at its own model's
 * cutoff, never the owner's "Not a meme", a held kind or a shill), that vectors are compared in
 * memory and read once, that a dry run writes nothing, and that titles go to the shown narratives.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { TitlePort } from '@insidor/contracts/ports/titles.ts';
import type { NarrativePass, NarrativePostRow } from '@insidor/store';

import { createLogger } from '../log.ts';
import { narrativeGrouper } from './narratives.ts';

const NOW = 1_800_000_000_000;
const meter = { line: () => ({ capUsd: 1, spentUsd: 0 }) } as unknown as Meter;
const log = createLogger({ test: 'narratives' });
const OPEN_JUDGE = 'judge:openrouter/google/gemma-3-27b-it@abc';
const MAIN_JUDGE = 'judge:anthropic/claude-haiku-4-5@abc';

const row = (itemId: string, extra: Partial<NarrativePostRow> = {}): NarrativePostRow => ({
  itemId,
  source: 'x',
  body: 'GTA 6 trailer two is finally out and it looks unreal',
  media: [{ kind: 'image', uri: `https://pics.invalid/${itemId}.jpg` }],
  atMs: NOW - 60_000,
  coinable: true,
  confidence: 0.99,
  lookedAt: 'picture',
  proposedName: 'GTA 6',
  alternateNames: [],
  judgeId: MAIN_JUDGE,
  kindLabel: null,
  ownerCall: null,
  ownTalk: false,
  ...extra,
});

const unit = (angle: number) => Float32Array.from([Math.cos(angle), Math.sin(angle)]);

function setup(rows: readonly NarrativePostRow[], vectors: Record<string, Float32Array>, mode: 'live' | 'dry' = 'live') {
  const saved: NarrativePass[] = [];
  const reads: string[][] = [];
  const titles: [string, string][] = [];
  const titler: TitlePort = {
    id: 't', model: 'm',
    async title(subjects) {
      return { value: subjects.map((s) => ({ kind: 'titled' as const, ref: s.ref, title: 'GTA 6 Trailer Two' })), spend: { vendor: 'v', endpoint: 'narrative-title', unit: 'per-call', units: 1, usd: 0.0001, at: NOW } } as never;
    },
  };
  const repo = {
    candidates: async () => rows,
    vectors: async (ids: readonly string[], _space: string, kind: 'post' | 'picture') => {
      if (kind === 'post') reads.push([...ids]);
      return new Map(kind === 'post' ? ids.flatMap((id) => (vectors[id] === undefined ? [] : [[id, vectors[id]] as const])) : []);
    },
    reach: async () => ({ points: new Map(), latest: new Map() }),
    open: async () => [],
    calls: async () => [],
    setTitle: async (id: string, title: string) => void titles.push([id, title]),
  };
  const grouper = narrativeGrouper({
    repo, save: async (p) => (saved.push(p), true), blockCutoff: async () => null, titler, embed: null, keepVectors: async () => false,
    meter, mode, policy: { ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, openCutoff: 0.95 } }, postSpace: 'post-space', log, now: () => NOW as Millis,
  });
  return { grouper, saved, reads, titles };
}

test('★ only good posts are grouped: the owner, held kinds, shills and the open model under its cutoff stay out', async () => {
  const rows = [
    row('a'), row('b'),
    row('owner', { ownerCall: 'not' }),
    row('ad', { kindLabel: 'AD' }),
    row('shill', { body: 'GTA 6 trailer out, buy $GTA now' }),
    row('open-low', { judgeId: OPEN_JUDGE, confidence: 0.9 }),
    row('open-high', { judgeId: OPEN_JUDGE, confidence: 0.97 }),
  ];
  const v = Object.fromEntries(rows.map((r) => [r.itemId, unit(0)]));
  const { grouper, saved, titles } = setup(rows, v);
  const r = await grouper.pass();
  assert.equal(r.good, 3);
  assert.deepEqual(r.left, { owner_not_meme: 1, held_kind: 1, shill: 1, judge_no: 1 });
  assert.deepEqual(saved[0]?.narratives.map((n) => [...n.members].sort()), [['a', 'b', 'open-high']]);
  assert.equal(saved[0]?.narratives[0]?.shown, true);
  assert.deepEqual(titles, [[saved[0]?.narratives[0]?.id ?? '', 'GTA 6 Trailer Two']]);
});

test('★ far apart in meaning, apart in narratives; vectors are read once for the life of the process', async () => {
  const rows = [row('a'), row('b'), row('c')];
  const { grouper, saved, reads } = setup(rows, { a: unit(0), b: unit(0.1), c: unit(1.5) });
  await grouper.pass();
  await grouper.pass();
  assert.deepEqual(saved[0]?.narratives.map((n) => [...n.members].sort()), [['a', 'b']]);
  assert.deepEqual(reads, [['a', 'b', 'c']], 'the second pass reads no vector again');
});

test('a dry run groups and writes nothing', async () => {
  const { grouper, saved } = setup([row('a'), row('b')], { a: unit(0), b: unit(0) }, 'dry');
  const r = await grouper.pass();
  assert.equal(r.narratives, 1);
  assert.equal(saved.length, 0);
});
