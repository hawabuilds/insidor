/**
 * Whether a post was deleted, from the re-reads already made: a failed read concludes nothing, a
 * source that cannot say what a left-out post means records nothing, one miss is unsure, a post
 * whose account has not been seen since is unsure (private or suspended look the same), and only two
 * misses with the account seen after the first is deleted. A post read again clears it all.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import type { UnreturnedPost } from '@insidor/store';

import type { Logger } from '../log.ts';
import { goneVerdict, noteRereads, rereadOutcome, settleGone, type GoneDeps } from './gone-posts.ts';

const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const T = 1_800_000_000_000;
const asked = [
  { itemId: 'x:1', sourceItemId: '1' },
  { itemId: 'x:2', sourceItemId: '2' },
];
const X = { leftOutIsGone: true };

test('an answered re-read: what came back is returned, what did not is left out', () => {
  assert.deepEqual(rereadOutcome(X, asked, new Map([['1', {}]])), { kind: 'answered', returned: ['x:1'], leftOut: ['x:2'] });
});

test('★ a failed re-read (a rate limit, an outage) concludes nothing about any post', () => {
  assert.deepEqual(rereadOutcome(X, asked, 'failed'), { kind: 'nothing', returned: [] });
});

test('★ a source that does not declare leftOutIsGone never leaves a post out', () => {
  assert.deepEqual(rereadOutcome({}, asked, new Map([['1', {}]])), { kind: 'nothing', returned: ['x:1'] });
});

const post = (over: Partial<UnreturnedPost> = {}): UnreturnedPost => ({ itemId: 'x:2', firstAt: T, lastAt: T + 600_000, misses: 2, accountSeenAt: T + 300_000, ...over });

test('★ deleted only with two misses and the account seen after the first — as of the first', () => {
  assert.deepEqual(goneVerdict(post()), { kind: 'deleted', at: T });
});

test('★ one miss is unsure: a short answer can do that', () => {
  assert.deepEqual(goneVerdict(post({ misses: 1 })), { kind: 'unsure', why: 'once' });
});

test('★ an account not seen since is unsure: a private or suspended account looks the same as a deleted post', () => {
  assert.deepEqual(goneVerdict(post({ accountSeenAt: null })), { kind: 'unsure', why: 'account_unseen' });
  assert.deepEqual(goneVerdict(post({ accountSeenAt: T })), { kind: 'unsure', why: 'account_unseen' });
});

function memory(pending: readonly UnreturnedPost[] = []) {
  const calls = { returned: [] as string[][], leftOut: [] as string[][], marked: [] as { itemId: string; at: number }[][] };
  const deps: GoneDeps = {
    log: quiet,
    repo: {
      returned: async (ids) => void calls.returned.push([...ids]),
      leftOut: async (ids) => void calls.leftOut.push([...ids]),
      pending: async () => pending,
      markDeleted: async (ps) => {
        calls.marked.push([...ps]);
        return ps.length;
      },
    },
  };
  return { deps, calls };
}

test('noting a re-read records both sides and marks only the proven post deleted', async () => {
  const { deps, calls } = memory([post(), post({ itemId: 'x:3', accountSeenAt: null })]);
  const marked = await noteRereads(deps, X, asked, new Map([['1', {}]]), T as Millis);
  assert.deepEqual(calls.returned, [['x:1']]);
  assert.deepEqual(calls.leftOut, [['x:2']]);
  assert.deepEqual(calls.marked, [[{ itemId: 'x:2', at: T }]]);
  assert.equal(marked, 1);
});

test('a store that cannot be written (before 0131) costs the pass nothing: no throw', async () => {
  const deps: GoneDeps = {
    log: quiet,
    repo: {
      returned: async () => { throw new Error('relation "internal.post_unreturned" does not exist'); },
      leftOut: async () => undefined,
      pending: async () => { throw new Error('missing'); },
      markDeleted: async () => 0,
    },
  };
  assert.equal(await noteRereads(deps, X, asked, new Map(), T as Millis), 0);
  assert.equal(await settleGone(deps), 0);
});
