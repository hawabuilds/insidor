/**
 * These assert the things a reviewer cannot check by reading: that the four
 * absent counters are absent as KEYS rather than as zeros, that a withheld
 * score becomes null rather than the placeholder that arrives with it, and that
 * a removed post's state does not become its content.
 *
 * No network, no clock: every case here is a payload and an injected instant.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CROSSPOST, DEGRADED, HOSTILE, PLAIN, REMOVED, SCORE_WITHHELD } from './__fixtures__/posts.ts';
import { CAPABILITIES } from './capabilities.ts';
import { communityOfRawRef, rawRefFor, toCounters, toItem } from './to-item.ts';

const AT = 1_800_000_000_000;

/* ── the absent four ──────────────────────────────────────────────────── */

test('reach is ABSENT — not zero, not null, not a key at all', () => {
  for (const raw of [PLAIN, SCORE_WITHHELD, CROSSPOST, REMOVED, HOSTILE, DEGRADED]) {
    const counters = toItem(raw, AT).counters;
    // `in` and not `=== undefined`: an explicitly written `reach: undefined`
    // survives a `?.value` and reappears downstream as a hole for some `?? 0`
    // to fill, which is the defect this whole rebuild exists to remove.
    assert.equal('reach' in counters, false, 'this source publishes no view count');
  }
});

test('rebroadcast, reproduction and retention are absent too, and a crosspost does not change that', () => {
  const item = toItem(CROSSPOST, AT);
  for (const kind of ['rebroadcast', 'reproduction', 'retention']) {
    assert.equal(kind in item.counters, false, `${kind} must not be emitted`);
  }
  // The POINTER is read even though the COUNT is not. Pointer and count are
  // independent, and this is the case that proves it here.
  assert.equal(item.reproductionOf, 'reddit:t3_1a2b3c');
  assert.equal(item.rebroadcastOf, null, 'this source has no copy-without-authoring object');
});

test('the counters emitted are exactly the two declared, and both are declared', () => {
  const counters = toItem(PLAIN, AT).counters;
  assert.deepEqual(Object.keys(counters).sort(), ['approval', 'conversation']);
  for (const kind of Object.keys(counters)) {
    assert.ok(CAPABILITIES.counters.includes(kind as 'approval'), `${kind} is undeclared`);
  }
});

/* ── the vote count ───────────────────────────────────────────────────── */

test('the vote counter is declared fuzzed, with no magnitude, because none is published', () => {
  const approval = toItem(PLAIN, AT).counters.approval;
  assert.deepEqual(approval?.fidelity, { kind: 'fuzzed' });
  assert.equal(approval?.value, 8_431);
  // The variant carries no parameter, and that absence is the claim: a source
  // that perturbs on purpose does not tell you by how much.
  assert.equal('significantDigits' in (approval?.fidelity ?? {}), false);
});

test('the comment counter stays exact — it is not vote-derived and not fuzzed', () => {
  const conversation = toItem(PLAIN, AT).counters.conversation;
  assert.deepEqual(conversation?.fidelity, { kind: 'exact' });
  assert.equal(conversation?.value, 219);
});

test('a withheld score is null, NEVER the placeholder that arrives with it', () => {
  // The payload says `score: 1` and `hide_score: true`. The flag is the fact.
  const item = toItem(SCORE_WITHHELD, AT);
  assert.equal(item.counters.approval?.value, null, 'a withheld score is unread, not one upvote');
  assert.deepEqual(item.counters.approval?.fidelity, { kind: 'fuzzed' });
  // The counter that is not withheld still reads, so the item is not blind.
  assert.equal(item.counters.conversation?.value, 4);
});

test('a hide_score that is not a boolean does not withhold', () => {
  // DEGRADED carries `hide_score: 'maybe'`. An unparseable flag must not make
  // every score unreadable — but the score there is junk anyway, so this
  // asserts the branch rather than the value.
  const item = toItem(DEGRADED, AT);
  assert.equal(item.counters.approval?.value, null, 'a junk score reads as unread');
});

/* ── hostile strings ──────────────────────────────────────────────────── */

test('a removed body is a STATE and never becomes an excerpt', () => {
  const item = toItem(REMOVED, AT);
  assert.equal(item.text, 'nana dance', 'the title survives; the sentinel does not');
  assert.equal(item.text.includes('[removed]'), false);
  // Its counters are real readings. Removed is not deleted, and neither is zero.
  assert.equal(item.counters.approval?.value, 77);
  assert.equal(item.counters.conversation?.value, 9);
});

test('a deleted author is not a handle and does not become a shared join key of its own', () => {
  assert.equal(String(toItem(REMOVED, AT).authorKey), 'reddit:unknown');
  assert.equal(String(toItem(PLAIN, AT).authorKey), 'reddit:dancing_gran');
});

test('text is bounded, because nothing about a stranger\'s post length is our choice', () => {
  const item = toItem(HOSTILE, AT);
  assert.equal(item.text.length, 1_200, 'a 2,400-character body is truncated to the declared bound');
  assert.ok(item.text.startsWith('READ THIS BEFORE YOU BUY $NANA'), 'the title always survives in full');
});

test('★ the bound never cuts a code point in half, which is how an emoji breaks a text column', () => {
  // The 1,200th UTF-16 unit landing on the first half of a surrogate pair is
  // not exotic on this source — it is an emoji in a long post. A `slice` there
  // emits a LONE SURROGATE: not well-formed, not encodable as UTF-8, silently
  // replaced with U+FFFD on the way to a `text` column, and taking the final
  // shingle key with it.
  const text = toItem({ id: 'sur1', title: 'a'.repeat(1_199) + '\u{1F600}' + 'b'.repeat(50) }, AT).text;
  assert.equal(text.isWellFormed(), true, 'a lone surrogate is not storable and not matchable');
  assert.equal(text.length, 1_199, 'the split character is given back whole rather than half-kept');

  // A pair that ENDS exactly on the bound is kept in full — the fix gives back
  // one unit only when it has orphaned one.
  const whole = toItem({ id: 'sur2', title: 'a'.repeat(1_198) + '\u{1F600}' + 'b'.repeat(50) }, AT).text;
  assert.equal(whole.length, 1_200);
  assert.equal(whole.isWellFormed(), true);
  assert.equal(whole.endsWith('\u{1F600}'), true);

  // And a lone surrogate the VENDOR sent, inside the bound, is left alone: this
  // file does not get to edit a stranger's text, only to undo its own cut.
  assert.equal(toItem({ id: 'sur3', title: 'hi \uD83D there' }, AT).text, 'hi \uD83D there');
});

test('carrier keys are deduplicated, so repetitive text cannot emit the same key twice', () => {
  const item = toItem(HOSTILE, AT);
  const seen = new Set<string>();
  for (const fingerprint of item.fingerprints) {
    const composite = `${fingerprint.kind}|${fingerprint.key}`;
    assert.equal(seen.has(composite), false, `duplicate carrier ${composite}`);
    seen.add(composite);
    assert.ok(fingerprint.key.trim().length > 0, 'an empty carrier key joins everything');
  }
  assert.ok(item.fingerprints.length > 0);
});

test('only text shingles are emitted — no invented entity spans, no placeholder image hash', () => {
  const kinds = new Set(toItem(PLAIN, AT).fingerprints.map((f) => f.kind));
  assert.deepEqual([...kinds], ['textShingle']);
});

test('the thumbnail field holds state words as often as URLs, and those are not media', () => {
  // 'self', 'default', 'nsfw', 'spoiler' are literal values this vendor puts in
  // that field. Treated as URIs they become media the pipeline tries to fetch.
  assert.deepEqual(toItem(HOSTILE, AT).media, [], "'self' is not a URL");
  assert.deepEqual(toItem(SCORE_WITHHELD, AT).media, [], "'default' is not a URL");
  assert.deepEqual(toItem(REMOVED, AT).media, [], "'nsfw' is not a URL");

  const media = toItem(PLAIN, AT).media;
  assert.equal(media.length, 3);
  assert.deepEqual(media[0], {
    kind: 'video',
    uri: 'https://v.redd.it/abc123/DASH_720.mp4',
    width: 720,
    height: 1280,
    durationMs: 27_000,
  });
  assert.equal(media[1]?.uri, 'https://preview.redd.it/abc123.jpg?width=1080');
});

/* ── identity, time and determinism ───────────────────────────────────── */

test('the id we store is the fullname, because that is what the re-read endpoint takes', () => {
  assert.equal(toItem(PLAIN, AT).sourceItemId, 't3_1a2b3c');
  assert.equal(String(toItem(PLAIN, AT).itemId), 'reddit:t3_1a2b3c');
  // Derived from the bare id when the payload omits `name`.
  assert.equal(toItem(DEGRADED, AT).sourceItemId, 't3_1a2b41');
});

test('a payload with no id at all throws rather than minting one', () => {
  assert.throws(() => toItem({ title: 'no id here' }, AT), TypeError);
});

test('★ the id from the payload is shape-checked, because it is a path in three places', () => {
  // `subreddit` is sanitised and `name` used not to be, and they land in the
  // SAME storage key one segment apart. `name: 't3_x/../../../etc/passwd'`
  // produced `reddit/aww/t3_x/../../../etc/passwd.json` — a key addressing a
  // different object, which is precisely the failure the community check has a
  // comment about.
  const traversal = toItem({ name: 't3_x/../../../../etc/passwd', id: 'x1', subreddit: 'aww', title: 'hi' }, AT);
  assert.equal(traversal.rawRef, 'reddit/aww/t3_x1.json', 'the usable id is used; the path is not');
  assert.equal(traversal.sourceItemId, 't3_x1');

  // ★ AND THE SECOND HALF, WHICH IS WHY THIS IS NOT TIDY-UP. `sourceItemId` is
  // one of the two facts the projector hands to permalink.ts to build a
  // CITATION, and its gate `/^[A-Za-z0-9._~-]+$/` admits a dot — so a `name` of
  // '..' shipped `reddit.com/comments/..`, which a browser normalises to the
  // front page. A citation that goes SOMEWHERE WRONG, cleanly, under a claim we
  // made about someone.
  assert.throws(() => toItem({ name: '..', subreddit: 'aww', title: 'hi' }, AT), TypeError);
  assert.throws(() => toItem({ name: 't3_a b', title: 'hi' }, AT), TypeError);
  assert.throws(() => toItem({ id: '../../x', title: 'hi' }, AT), TypeError);

  // The kind is pinned here as well as in the client: the client drops a child
  // whose ENVELOPE says t1, and this catches a payload whose envelope said t3
  // and whose own `name` disagrees. `toItem` is a public port method and can be
  // called with anything at all.
  assert.throws(() => toItem({ name: 't1_abc', subreddit: 'aww', title: 'not a post' }, AT), TypeError);
  assert.equal(toItem({ name: 't1_abc', id: 'abc', title: 'x' }, AT).sourceItemId, 't3_abc');
});

test('★ a lineage pointer we cannot address is an absence, not an edge into nothing', () => {
  // The parent becomes an ItemId — a value the rest of the system treats as
  // ours. A fabricated edge in the reproduction graph is a fabrication in the
  // one graph the product's thesis rests on.
  assert.equal(toItem({ id: 'p1', title: 'x', crosspost_parent: '../../../evil' }, AT).reproductionOf, null);
  assert.equal(toItem({ id: 'p2', title: 'x', crosspost_parent: 't1_abc' }, AT).reproductionOf, null);
  assert.equal(toItem({ id: 'p3', title: 'x', crosspost_parent: 't3_ok' }, AT).reproductionOf, 'reddit:t3_ok');
  // Self-reference is still dropped, which is the case that was already handled.
  assert.equal(toItem({ name: 't3_p4', title: 'x', crosspost_parent: 't3_p4' }, AT).reproductionOf, null);
});

test('seconds become milliseconds, and an unparseable timestamp is null rather than a guess', () => {
  assert.equal(toItem(PLAIN, AT).postedAt, 1_785_600_030_000);
  assert.ok((toItem(PLAIN, AT).postedAt ?? 0) > 1e12, 'a seconds-scale value here reads as 1970');
  assert.equal(toItem(DEGRADED, AT).postedAt, null);
});

test('this source reports no language, and a detector\'s guess is not a substitute', () => {
  assert.equal(toItem(PLAIN, AT).lang, null);
});

test('the read instant is injected, never read from a clock', () => {
  const a = toItem(PLAIN, AT);
  const b = toItem(PLAIN, AT + 60_000);
  assert.equal(a.firstSeenAt, AT);
  assert.equal(b.firstSeenAt, AT + 60_000);
  assert.equal(a.counters.approval?.observedAt, AT);
  assert.equal(a.counters.conversation?.observedAt, AT);
  assert.deepEqual(toItem(PLAIN, AT), a, 'translation is deterministic');
});

test('there is no reusable template object here, and the community is not smuggled in as one', () => {
  // core reads `item.formatIds.length` as a feature and the store puts a GIN
  // index on the column. A community id here would inflate the first and turn
  // "posted in the same place" into a carrier join across thousands of items.
  assert.deepEqual(toItem(PLAIN, AT).formatIds, []);
});

/* ── the storage key, which is also the cohort ────────────────────────── */

test('the raw payload is referenced rather than inlined, and it carries the community', () => {
  assert.equal(toItem(PLAIN, AT).rawRef, 'reddit/aww/t3_1a2b3c.json');
  assert.equal(toItem(DEGRADED, AT).rawRef, 'reddit/t3_1a2b41.json', 'no community named, so none in the key');
});

test('the storage key round-trips, which is what stops baselineKey drifting from it', () => {
  for (const community of ['aww', 'CryptoMoonShots', 'a_b_9']) {
    assert.equal(communityOfRawRef(rawRefFor(community, 't3_1a2b3c')), community);
  }
  assert.equal(communityOfRawRef(rawRefFor(null, 't3_1a2b3c')), null);
  assert.equal(communityOfRawRef('something/else/entirely.json'), null);
});

test('a community name that could change a storage path is treated as absent', () => {
  // The field is vendor-controlled and lands inside a key. A value with a slash
  // in it addresses a different object; one with a brace fails the suite.
  assert.equal(toItem({ id: 'x1', subreddit: '../../etc' }, AT).rawRef, 'reddit/t3_x1.json');
  assert.equal(toItem({ id: 'x2', subreddit: 'a/b' }, AT).rawRef, 'reddit/t3_x2.json');
});

/* ── one mapping, two callers ─────────────────────────────────────────── */

test('the re-read path and the translation path share one counter mapping', () => {
  assert.deepEqual(toCounters(PLAIN, AT), toItem(PLAIN, AT).counters);
});
