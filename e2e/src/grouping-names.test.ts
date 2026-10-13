/**
 * ★ GROUP ON THE JUDGE'S NAME, END TO END: two posts about the same roller coaster each start
 * a story alone, because neither is named when GROUP first sees them. Once the judge names both
 * "GOLIATH" — and both posts say the word — the next pass re-asks the one-post stories: the
 * later one joins the earlier one's story, and its own story is folded in. A post the judge
 * called "SMILING PIG" whose text never says it stays alone.
 *
 * Real schema (PGlite) and the real GROUP loop; no vendor is involved, the names are written
 * the way the per-post judge writes them.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import type { Item, Judgement, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { policyHash } from '@insidor/runner/src/hash.ts';
import type { Logger } from '@insidor/runner/src/log.ts';
import { groupLoop } from '@insidor/runner/src/loops/group.ts';
import { storeWork } from '@insidor/runner/src/work/stages.ts';
import {
  PgAssetRepo,
  PgAuthorRepo,
  PgDecisionRepo,
  PgImageEmbeddingRepo,
  PgItemRepo,
  PgJudgementRepo,
  PgObservationRepo,
  PgPostJudgementRepo,
  PgStoryRepo,
} from '@insidor/store';
import type { Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const NOW = Date.now() as Millis;
const MIN = 60_000;
const P = DEFAULT_POLICY;
const X = sourceId('x');
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const openMeter = {
  record: () => undefined,
  spentUsd: () => 0,
  mayspend: () => true,
  line: () => ({ capUsd: 21, spentUsd: 0, stopAtUsd: 21, remainingUsd: 21, unrecordedUsd: 0 }),
} as unknown as Meter;

let db: Db;

function post(n: number, author: string, text: string, minutesAgo: number): Item {
  return {
    itemId: itemId(X, `${n}`), source: X, sourceItemId: `${n}`, origin: 'observed', authorKey: authorKey(X, author),
    postedAt: NOW - minutesAgo * MIN, firstSeenAt: NOW - minutesAgo * MIN, lang: 'en', text,
    media: [], counters: {}, fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: `x/${n}`,
  };
}

const named = (name: string): Judgement => ({
  judgeId: 'judge:test@1', promptId: 'post-coinability@1', judgedAt: NOW, coinable: true, confidence: 0.85, lookedAt: 'text',
  proposedName: name, alternateNames: [], subjectSpans: [], rationaleRef: null, costUsd: 0,
});

function loop() {
  const decisions = new PgDecisionRepo(db);
  const repos = {
    items: new PgItemRepo(db), authors: new PgAuthorRepo(db), observations: new PgObservationRepo(db),
    stories: new PgStoryRepo(db), assets: new PgAssetRepo(db), decisions,
  };
  const work = storeWork(
    repos,
    P,
    { judge: null, judgements: new PgJudgementRepo(db), meter: openMeter, mode: 'dry', policy: P, log: quiet },
    { platforms: { has: () => false, get: () => { throw new Error('no source'); } }, meter: openMeter, mode: 'dry', log: quiet, now: () => NOW },
    { images: new PgImageEmbeddingRepo(db), postScores: new PgPostJudgementRepo(db), storyJudgements: new PgJudgementRepo(db), pairs: null },
  );
  return groupLoop({
    policy: P,
    policyHash: policyHash(P),
    decisions: { write: (d) => decisions.append(d), markApplied: (id, at) => decisions.markApplied(id, at) },
    log: quiet,
    ...work,
  });
}

before(async () => {
  db = await migratedDb();
  const decisions = new PgDecisionRepo(db);
  for (const day of [NOW - 86_400_000, NOW, NOW + 86_400_000]) await decisions.ensurePartition(new Date(day).toISOString().slice(0, 10));
  await decisions.recordPolicy(policyHash(P), P, 'e2e');
  await new PgItemRepo(db).upsert([
    post(1, 'wsb', 'JUST IN: Man dies after falling out of the Goliath roller coaster at Six Flags', 40),
    post(2, 'breaking', 'Man reportedly falls to his death from the 200-foot-tall "Goliath" roller coaster', 30),
    post(3, 'pets', 'A smile for your timeline..', 20),
  ]);
});

test('★ two posts named the same, and saying it, end in one story once the judge has named them', async () => {
  // First pass: nobody is named yet, so each post starts a story alone.
  const first = await loop().run({ signal: new AbortController().signal, now: () => NOW });
  assert.equal(first.failed, 0, first.firstError ?? '');
  const alone = await db.query<{ n: number }>(`select count(*)::int as n from public.story where state <> 'merged'`);
  assert.equal(alone[0]?.n, 3, 'three posts, three one-post stories');

  const scores = new PgPostJudgementRepo(db);
  await scores.record(itemId(X, '1'), named('GOLIATH'));
  await scores.record(itemId(X, '2'), named('GOLIATH'));
  await scores.record(itemId(X, '3'), named('SMILING PIG'));
  // The kind question's answer is never a name, even though it sits in the same table.
  await scores.record(itemId(X, '3'), { ...named('SPORT'), promptId: 'post-kind@1', coinable: false });

  const second = await loop().run({ signal: new AbortController().signal, now: () => (NOW + 3 * MIN) as Millis });
  assert.equal(second.failed, 0, second.firstError ?? '');

  const homes = await new PgStoryRepo(db).storiesOfItems([itemId(X, '1'), itemId(X, '2'), itemId(X, '3')]);
  assert.equal(homes.get(itemId(X, '1')), homes.get(itemId(X, '2')), 'the two coaster posts share a story');
  assert.notEqual(homes.get(itemId(X, '3')), homes.get(itemId(X, '1')), 'the pig, whose post never says its name, does not');

  const merged = await db.query<{ n: number }>(`select count(*)::int as n from public.story where state = 'merged'`);
  assert.equal(merged[0]?.n, 1, 'the later one-post story was folded into the earlier one, not deleted');
  const row = await db.query<{ evidence_kind: string; carrier_key: string }>(
    `select m.evidence_kind, m.carrier_key from public.story_member m join public.story s using (story_id)
      where m.item_id = 'x:2' and s.merged_into is null`,
  );
  assert.deepEqual(row[0], { evidence_kind: 'carrier', carrier_key: 'name:goliath' }, 'and the member row says why: the name');
});
