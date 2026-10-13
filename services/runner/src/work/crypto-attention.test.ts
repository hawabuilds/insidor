/**
 * The crypto-attention step: only posts over the reach bar, only sources that can read responses,
 * the day's cap from the table, a dry run priced and unread, and a failed read recorded as nothing.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { AttentionRow, DueAttention } from '@insidor/store';

import type { Logger } from '../log.ts';
import { readCryptoAttention, type AttentionDeps } from './crypto-attention.ts';

const NOW = 1_800_000_000_000 as Millis;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const meter = {
  mayspend: () => true,
  record: () => undefined,
  spentUsd: () => 0,
  line: () => ({ capUsd: 10, spentUsd: 0, stopAtUsd: 10, remainingUsd: 10, unrecordedUsd: 0 }),
} as unknown as Meter;

const due = (id: string, source = 'x'): DueAttention => ({ itemId: `${source}:${id}`, source, sourceItemId: id, postedAt: (NOW - 3_600_000) as Millis, reads: 0, judgedYes: false, text: TEXT, authorId: 'au', authorHandle: 'poster' });
let TEXT = 'a dog';

function deps(over: { readsToday?: number; fail?: boolean; mode?: 'dry' | 'live'; text?: string; ownReply?: boolean } = {}) {
  const recorded: { id: string; row: AttentionRow }[] = [];
  const filed: { id: string; name: string | null; prompt: string }[] = [];
  const asked: string[] = [];
  const text = {
    id: 'x',
    responses: async (id: string) => {
      asked.push(id);
      if (over.fail === true) throw new Error('vendor down');
      return {
        value: { replies: [{ sourceItemId: 'r', at: NOW, text: '$DOG', authorId: over.ownReply === true ? 'au' : 'other', authorHandle: 'a', authorName: null, authorBio: null }], reproductions: [], repliesCut: false, reproductionsCut: false },
        spend: { vendor: 'v', endpoint: 'responses', unit: 'per-item-returned', units: 1, usd: 0.00015, at: NOW },
      };
    },
    estimateResponses: () => ({ vendor: 'v', endpoint: 'responses', unit: 'per-item-returned', estUnits: 40, usd: 0.006 }),
  } as unknown as PlatformAdapter;
  const video = { id: 'tiktok' } as unknown as PlatformAdapter;
  const d: AttentionDeps = {
    platforms: { all: () => [text, video] },
    attention: {
      readsSince: async () => over.readsToday ?? 0,
      due: async (sources) => [due('1'), due('2'), due('3', 'tiktok')].filter((x) => sources.includes(x.source)),
      record: async (id, _at, row) => void recorded.push({ id, row }),
    },
    kinds: { record: async (id, j) => void filed.push({ id: String(id), name: j.proposedName, prompt: j.promptId }) },
    items: {
      reachReadings: async () =>
        new Map([
          ['x:1', [{ atMs: NOW, reach: 50_000 }]],
          ['x:2', [{ atMs: NOW, reach: 3_000 }]],
        ]),
    },
    meter,
    mode: over.mode ?? 'live',
    policy: DEFAULT_POLICY,
    log: quiet,
    now: () => NOW,
  };
  return { d, recorded, asked, filed };
}

test('★ only the post over the bar, on a source that reads responses, is read and stored as facts', async () => {
  const { d, recorded, asked } = deps();
  const out = await readCryptoAttention(d);
  assert.deepEqual(asked, ['1']);
  assert.equal(out.read, 1);
  assert.equal(out.withSignal, 1);
  assert.deepEqual(recorded[0]?.row.cashtags, { DOG: 1 });
  assert.equal(recorded[0]?.row.costUsd, 0.00015);
  assert.deepEqual(recorded[0]?.row.others?.cashtags, { DOG: 1 }, "another account's cashtag is the signal");
  assert.equal(recorded[0]?.row.postShill, false);
});

test('the day\'s cap, counted from the table, stops the step', async () => {
  const { d, asked } = deps({ readsToday: DEFAULT_POLICY.attention.postsPerDay });
  assert.equal((await readCryptoAttention(d)).read, 0);
  assert.deepEqual(asked, []);
});

test('a dry run prices the read and reads nothing', async () => {
  const { d, asked, recorded } = deps({ mode: 'dry' });
  const out = await readCryptoAttention(d);
  assert.deepEqual(asked, []);
  assert.equal(recorded.length, 0);
  assert.equal(out.wouldSpendUsd, 0.006);
});

test('★ a failed read records nothing: an outage is not "no crypto talk"', async () => {
  const { d, recorded } = deps({ fail: true });
  assert.equal((await readCryptoAttention(d)).read, 0);
  assert.equal(recorded.length, 0);
});

test('★ a shill is filed as an ad kind answer: by its own text before any read, or by the author\'s own replies', async () => {
  const own = deps({ ownReply: true });
  await readCryptoAttention(own.d);
  assert.deepEqual(own.filed, [{ id: 'x:1', name: 'AD', prompt: 'post-kind@shill-rule-1' }]);
  assert.equal(own.recorded[0]?.row.own?.cashtags.DOG, 1);

  const clean = deps();
  await readCryptoAttention(clean.d);
  assert.deepEqual(clean.filed, [], "another account's cashtag is a signal, not a shill");

  TEXT = 'buy $DOG now';
  const text = deps({ fail: true });
  await readCryptoAttention(text.d);
  TEXT = 'a dog';
  assert.deepEqual(text.filed.map((f) => f.name), ['AD'], 'filed even when the read fails');

  const dry = deps({ mode: 'dry', ownReply: true });
  await readCryptoAttention(dry.d);
  assert.deepEqual(dry.filed, []);
});
