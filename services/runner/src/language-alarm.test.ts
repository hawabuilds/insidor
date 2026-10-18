/**
 * The owner's language-drop alarm (language-alarm.ts): a recent drop queued once as an outage alert,
 * the same drop after a restart under the same subject, an old one never, a language inside a
 * whole-source drop not on its own, and nothing queued with no owner.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { LanguageFinds } from '@insidor/core';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { OwnerAlert } from '@insidor/store';

import { languageAlarm, languageName, type LanguageAlarmDeps } from './language-alarm.ts';
import type { Logger } from './log.ts';

const P = DEFAULT_POLICY.notify.languageDrop;
const H = 3_600_000;
const DROP = Date.UTC(2026, 9, 16, 23, 0);
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };

/* en 300 an hour and ja 300 an hour until DROP, then en 10 (ja holds, so the source's total does not fall by 70%). */
function finds(source: string, _lanes: readonly string[], fromMs: number, toMs: number, bucketMs: number): Promise<readonly LanguageFinds[]> {
  const out: LanguageFinds[] = [];
  if (source !== 'x') return Promise.resolve(out);
  for (let t = fromMs; t < toMs; t += bucketMs) {
    out.push({ lang: 'en', atMs: t, finds: Math.round(((t >= DROP ? 10 : 300) * bucketMs) / H) });
    out.push({ lang: 'ja', atMs: t, finds: Math.round((300 * bucketMs) / H) });
  }
  return Promise.resolve(out);
}

function harness(now: { ms: number }, over: Partial<LanguageAlarmDeps> = {}) {
  const queued: OwnerAlert[] = [];
  const deps: LanguageAlarmDeps = {
    policy: P,
    buckets: finds,
    ownerWallets: ['wallet'],
    owner: { ownerIds: async () => ['owner-1'], queue: async (_u, a) => void queued.push(a) },
    log: quiet,
    now: () => now.ms,
    ...over,
  };
  return { queued, deps };
}

test('★ a language that just dropped is queued once as an outage, and a restart queues the same subject', async () => {
  const now = { ms: DROP + 3 * H };
  const { queued, deps } = harness(now);
  const alarm = languageAlarm(deps);
  assert.equal(await alarm.check(), 1);
  assert.equal(queued[0]!.kind, 'outage');
  assert.equal(queued[0]!.facts['what'], 'lang');
  assert.equal(queued[0]!.facts['language'], 'English');
  assert.equal(queued[0]!.facts['source'], 'X');
  now.ms += P.everyMs;
  assert.equal(await alarm.check(), 0, 'the next pass does not queue it again');
  const restarted = harness(now);
  await languageAlarm(restarted.deps).check();
  assert.equal(restarted.queued[0]!.subject, queued[0]!.subject, 'a restart names the same drop: the claim drops the second');
});

test('a drop older than the announce window is never pushed (a deploy mid-drop says nothing old)', async () => {
  const { queued, deps } = harness({ ms: DROP + 6 * H });
  assert.equal(await languageAlarm(deps).check(), 0);
  assert.equal(queued.length, 0);
});

test('no owner wallet: logged, nothing queued; switched off: nothing read', async () => {
  let read = 0;
  const noOwner = harness({ ms: DROP + 3 * H }, { ownerWallets: [] });
  assert.equal(await languageAlarm(noOwner.deps).check(), 0);
  assert.equal(noOwner.queued.length, 0);
  const off = harness({ ms: DROP + 3 * H }, { policy: { ...P, on: false }, buckets: async () => (read += 1, []) });
  await languageAlarm(off.deps).check();
  assert.equal(read, 0);
});

test('a failed read is skipped for that source, never thrown', async () => {
  const { queued, deps } = harness({ ms: DROP + 3 * H }, { buckets: async () => Promise.reject(new Error('no db')) });
  assert.equal(await languageAlarm(deps).check(), 0);
  assert.equal(queued.length, 0);
});

test('codes that are not languages read as what they are', () => {
  assert.equal(languageName('en'), 'English');
  assert.equal(languageName('pt'), 'Portuguese');
  assert.equal(languageName('zxx'), 'no-text');
  assert.equal(languageName('qme'), 'media-only');
});
