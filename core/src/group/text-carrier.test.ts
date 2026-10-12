/**
 * The adapter's phrases become one storable, comparable text hash — or none, for short text.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Fingerprint, Item } from '@insidor/contracts/vocabulary.ts';

import { hexHamming, isHexHash } from '../bits.ts';
import { withTextHash } from './text-carrier.ts';

const FEED = sourceId('feed-a');
const SPAN: Fingerprint = { kind: 'entitySpan', key: 'hashtag:moodeng' };

/** Five-word windows, as the adapters' shared `shingles` makes them. */
function phrases(text: string): Fingerprint[] {
  const words = text.split(' ');
  const out: Fingerprint[] = [];
  for (let i = 0; i + 5 <= words.length; i++) out.push({ kind: 'textShingle', key: words.slice(i, i + 5).join(' ') });
  return out;
}

function post(text: string): Item {
  return {
    itemId: itemId(FEED, 'p1'),
    source: FEED,
    sourceItemId: 'p1',
    origin: 'observed',
    authorKey: authorKey(FEED, 'a1'),
    postedAt: null,
    firstSeenAt: 0,
    lang: null,
    text,
    media: [],
    counters: {},
    fingerprints: [SPAN, ...phrases(text)],
    rebroadcastOf: null,
    reproductionOf: null,
    formatIds: [],
    rawRef: 'local:test/p1',
  };
}

const LONG = 'the baby hippo at the zoo yawned on camera and everyone is now making their own version of it';

test('★ the phrases become one hex hash of the configured width, which the store accepts', () => {
  const hashed = withTextHash(post(LONG), DEFAULT_POLICY);
  const text = hashed.fingerprints.filter((f) => f.kind === 'textShingle');
  assert.equal(text.length, 1);
  assert.equal(text[0]?.bits, DEFAULT_POLICY.group.textHashBits);
  assert.ok(isHexHash(text[0]?.key ?? '', DEFAULT_POLICY.group.textHashBits));
});

test('every other carrier is left as the adapter wrote it', () => {
  assert.deepEqual(withTextHash(post(LONG), DEFAULT_POLICY).fingerprints[0], SPAN);
});

test('the same text posted twice hashes the same; unrelated text lands outside the match distance', () => {
  /* Identity, not near-identity: how close a one-word edit lands is the calibration of
     `textHashMaxDistance`, a policy number this step does not own. */
  const a = withTextHash(post(LONG), DEFAULT_POLICY).fingerprints.at(-1)?.key ?? '';
  const b = withTextHash(post(LONG), DEFAULT_POLICY).fingerprints.at(-1)?.key ?? '';
  const c = withTextHash(post('light rain is expected across the north this evening with clearer skies by the morning commute'), DEFAULT_POLICY).fingerprints.at(-1)?.key ?? '';
  assert.equal(hexHamming(a, b), 0);
  assert.ok(hexHamming(a, c) > DEFAULT_POLICY.group.textHashMaxDistance, `unrelated at ${hexHamming(a, c)}`);
});

test('short text has no text carrier at all, rather than a hash that matches everything short', () => {
  const hashed = withTextHash(post('moo deng yawning again'), DEFAULT_POLICY);
  assert.deepEqual(hashed.fingerprints, [SPAN]);
});

test('a post that already carries a hash is left alone, so a second pass changes nothing', () => {
  const once = withTextHash(post(LONG), DEFAULT_POLICY);
  assert.deepEqual(withTextHash(once, DEFAULT_POLICY), once);
});
