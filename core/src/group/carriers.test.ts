/**
 * The free tier of grouping, and the tier that does most of the work.
 *
 * ★ WHAT IS BEING PROVEN AGAINST INVENTED DATA — SAY IT BEFORE THE GREEN TICKS DO. Every
 * fingerprint in this file was written here. There are no labelled pairs anywhere in this
 * system, no near-miss carriers in the seed, and no adapter that produces an image hash at
 * all. So these tests prove that the intersection is correct arithmetic against the bars
 * the policy names, that the weighting is wired to persistence.ts, and that a malformed
 * carrier degrades instead of stopping. They prove nothing about recall and nothing about
 * precision, and a suite this green would look exactly the same if the bars were wrong.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Fingerprint } from '@insidor/contracts/vocabulary.ts';

import { carrierMatches, corpusKey } from './carriers.ts';
import type { CarrierCorpus } from './carriers.ts';

const P = DEFAULT_POLICY;
const IMAGE_HEX = P.group.imageHashBits / 4; // 64 characters
const TEXT_HEX = P.group.textHashBits / 4; // 16 characters

/* ── fixtures ─────────────────────────────────────────────────────────── */

const image = (key: string): Fingerprint => ({ kind: 'imageHash', key, bits: P.group.imageHashBits });
const text = (key: string): Fingerprint => ({ kind: 'textShingle', key, bits: P.group.textHashBits });
const format = (key: string): Fingerprint => ({ kind: 'formatId', key });
const span = (key: string): Fingerprint => ({ kind: 'entitySpan', key });

const IMAGE_ZERO = '0'.repeat(IMAGE_HEX);
/** 28 set bits plus 3: exactly imageHashMaxDistance from IMAGE_ZERO. */
const IMAGE_AT_BAR = `fffffff7${'0'.repeat(IMAGE_HEX - 8)}`;
/** One bit further out. */
const IMAGE_OVER_BAR = `ffffffff${'0'.repeat(IMAGE_HEX - 8)}`;

const TEXT_ZERO = '0'.repeat(TEXT_HEX);
/** 3 set bits: exactly textHashMaxDistance. */
const TEXT_AT_BAR = `7${'0'.repeat(TEXT_HEX - 1)}`;
/** 4 set bits. */
const TEXT_OVER_BAR = `f${'0'.repeat(TEXT_HEX - 1)}`;

/* ── ★ the claim this file owns ───────────────────────────────────────── */

test('an item sharing an exact carrier joins with no model call', () => {
  /* "No model call" is provable here structurally, not just behaviourally: there is no
     similarity argument in this function to pass one through. The free tier settles the
     pair with the item's fingerprints, the story's carriers and the policy — and nothing
     else exists to consult. An embedding outage cannot reach this code path because the
     embedding cannot reach this code path.

     The stage half of the same claim — that the verdict is `pass` and the reason is
     M0_carrier_join — belongs to group/stage.test.ts, which owns group/stage.ts. */
  const matches = carrierMatches([format('sound-88213'), text(TEXT_ZERO)], [format('sound-88213')], P);

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.carrier.kind, 'formatId');
  assert.equal(matches[0]?.carrier.key, 'sound-88213');
  assert.ok((matches[0]?.weight ?? 0) > 0, 'an exact carrier nobody has worn out is evidence');
});

test('an exact-match kind reports a null distance, never a zero', () => {
  /* A zero would claim we measured something. formatId and entitySpan have no metric —
     which is why store/migrations/0004_stories.sql leaves carrier_distance nullable and
     constrains it to the carrier kinds that have one. A store-side 0 from CarrierHit
     must never become an evidence-side 0. */
  for (const fingerprint of [format('sound-88213'), span('refuses to dock')]) {
    const matches = carrierMatches([fingerprint], [fingerprint], P);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.distance, null);
  }
});

test('a hash carrier reports the distance it actually measured', () => {
  const matches = carrierMatches([image(IMAGE_ZERO)], [image(IMAGE_AT_BAR)], P);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.distance, P.group.imageHashMaxDistance);
});

/* ── the bars ─────────────────────────────────────────────────────────── */

test('the per-kind distance bars are bars: at the bar joins, one bit past it does not', () => {
  assert.equal(carrierMatches([image(IMAGE_ZERO)], [image(IMAGE_AT_BAR)], P).length, 1);
  assert.equal(carrierMatches([image(IMAGE_ZERO)], [image(IMAGE_OVER_BAR)], P).length, 0);

  assert.equal(carrierMatches([text(TEXT_ZERO)], [text(TEXT_AT_BAR)], P).length, 1);
  assert.equal(carrierMatches([text(TEXT_ZERO)], [text(TEXT_OVER_BAR)], P).length, 0);
});

test('a bar calibrated for one width is never applied to another', () => {
  /* 3 out of 64 and 31 out of 256 are different claims. A text hash that arrives
     declaring 256 bits is not a wider text hash — it is a fingerprint we cannot compare,
     and the text bar must not be reached for it. */
  const wrongWidth: Fingerprint = { kind: 'textShingle', key: TEXT_ZERO, bits: P.group.imageHashBits };
  assert.equal(carrierMatches([wrongWidth], [text(TEXT_ZERO)], P).length, 0);
  assert.equal(carrierMatches([text(TEXT_ZERO)], [wrongWidth], P).length, 0);
});

test('the key is comparable only against the same kind', () => {
  /* Fingerprint.key is opaque. An entitySpan and a formatId that happen to spell the
     same string are two different things, and joining them would be a join on a
     coincidence of encoding. */
  assert.equal(carrierMatches([span('sound-88213')], [format('sound-88213')], P).length, 0);
  assert.equal(carrierMatches([image(TEXT_ZERO)], [text(TEXT_ZERO)], P).length, 0);
});

/* ── nothing shared, and nothing shareable ────────────────────────────── */

test('nothing shared is an empty array, never a throw', () => {
  assert.deepEqual(carrierMatches([], [], P), []);
  assert.deepEqual(carrierMatches([format('a')], [], P), []);
  assert.deepEqual(carrierMatches([], [format('a')], P), []);
  assert.deepEqual(carrierMatches([format('a')], [format('b')], P), []);
});

test('an empty key is not a carrier', () => {
  /* Otherwise every item an adapter failed to extract from joins every other one. */
  assert.equal(carrierMatches([span('')], [span('')], P).length, 0);
  assert.equal(carrierMatches([format('')], [format('')], P).length, 0);
});

test('★ a malformed hash carrier degrades the join, it does not stop it', () => {
  /* This is not hypothetical. Every adapter in this repository emits a textShingle whose
     key is the raw five-word phrase while declaring 64 bits — `my nana learns the dance`
     is not sixteen hex characters, and the store already refuses to write it. If this
     function threw on one, a single malformed row would stop grouping for every item
     behind it in the block. It returns "we could not establish they share it" instead,
     which is the true statement, and the item's other carriers still join. */
  const malformed: Fingerprint = { kind: 'textShingle', key: 'my nana learns the dance', bits: P.group.textHashBits };

  assert.doesNotThrow(() => carrierMatches([malformed], [malformed], P));
  assert.equal(carrierMatches([malformed], [malformed], P).length, 0);

  const matches = carrierMatches([malformed, format('sound-88213')], [malformed, format('sound-88213')], P);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.carrier.kind, 'formatId');
});

test('an uppercase hash is the same bits and a different string, and is refused', () => {
  /* One spelling, enforced at the door — otherwise the store's exact index and the bit
     comparison disagree about whether two carriers match, and which answer you get
     depends on which query ran. */
  const lower = 'a'.repeat(TEXT_HEX);
  const upper: Fingerprint = { kind: 'textShingle', key: 'A'.repeat(TEXT_HEX), bits: P.group.textHashBits };
  assert.equal(carrierMatches([upper], [text(lower)], P).length, 0);
  assert.equal(carrierMatches([text(lower)], [text(lower)], P).length, 1);
});

/* ── ★ weight: the two independent ways to be worth nothing ───────────── */

test('a generic symbol is worth zero whatever its frequency, and is still reported', () => {
  /* WORTHLESS BY NATURE. Two items sharing this are not two versions of the same moment;
     they are two items that both mentioned money. One story in the build this replaces
     accreted thirty-nine unrelated posts on exactly this.

     It comes back as a match with weight 0 rather than being filtered out, because "they
     share nothing" and "they share something worthless" are different findings and owe
     different reason codes — M6/M3 against M5_generic_carrier. Filtering here would erase
     the distinction before the stage could log it. */
  for (const symbol of ['$SOL', 'SOL', 'usdc', 'PUMP', 'MEME']) {
    const matches = carrierMatches([span(symbol)], [span(symbol)], P);
    assert.equal(matches.length, 1, `${symbol} should still be reported`);
    assert.equal(matches[0]?.weight, 0, `${symbol} must be worth nothing`);
  }

  /* And no amount of rarity redeems it: an empty corpus is maximal rarity. */
  const rare: CarrierCorpus = { [corpusKey(span('$SOL'))]: { idf24h: 99, dfByBucket: [] } };
  assert.equal(carrierMatches([span('$SOL')], [span('$SOL')], P, rare)[0]?.weight, 0);
});

test('a term present in almost every bucket is weighted to nothing', () => {
  /* WORTHLESS BY WEAR, through the same carrierWeight() the persistence tests pin. */
  const alwaysThere = new Array<number>(14).fill(40);
  const corpus: CarrierCorpus = {
    [corpusKey(span('hipposeason'))]: { idf24h: 5, dfByBucket: alwaysThere },
  };
  const matches = carrierMatches([span('hipposeason')], [span('hipposeason')], P, corpus);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.weight, 0);
});

test('a term that spiked in the last two buckets keeps almost all its weight', () => {
  /* The case raw document frequency gets backwards, reaching the carrier join intact: a
     meme that spawns many posts raises its own terms' frequency, so a plain
     document-frequency cutoff punishes exactly the story the product exists for. */
  const brandNew = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 80, 120];
  const corpus: CarrierCorpus = {
    [corpusKey(span('hipposeason'))]: { idf24h: 5, dfByBucket: brandNew },
  };
  const w = carrierMatches([span('hipposeason')], [span('hipposeason')], P, corpus)[0]?.weight ?? 0;
  assert.ok(w > 4, `expected nearly full weight, got ${w}`);
});

test('an unknown carrier keeps its weight, because the bucket table is empty on day one', () => {
  /* The history accrues forward only and nothing writes it yet, so "the corpus has never
     seen this" is the state every carrier is in today. Defaulting that to zero would mean
     nothing joins at all until fourteen days of history exist, and grouping has to work
     on the first afternoon. The cost is precision, and it is bounded by the by-nature
     list, which needs no corpus. */
  const matches = carrierMatches([span('hipposeason')], [span('hipposeason')], P);
  assert.ok((matches[0]?.weight ?? 0) > 0);

  /* And the corpus is keyed by kind AND key, so one kind's frequency cannot silence
     another kind that happens to spell the same string. */
  const corpus: CarrierCorpus = {
    [corpusKey(span('overlap'))]: { idf24h: 5, dfByBucket: new Array<number>(14).fill(40) },
  };
  assert.equal(carrierMatches([span('overlap')], [span('overlap')], P, corpus)[0]?.weight, 0);
  assert.ok((carrierMatches([format('overlap')], [format('overlap')], P, corpus)[0]?.weight ?? 0) > 0);
});

/* ── shape of the result ──────────────────────────────────────────────── */

test('one match per item fingerprint, never the cross product', () => {
  /* A story that has accreted fifty text hashes would otherwise return fifty matches for
     one arriving hash, and the stage would read fifty pieces of evidence where there is
     one. The story carrier kept is the closest, because that is the one that admitted it. */
  const storyCarriers = [
    image(IMAGE_ZERO),
    image(IMAGE_AT_BAR),
    image(`f${'0'.repeat(IMAGE_HEX - 1)}`),
  ];
  const matches = carrierMatches([image(IMAGE_ZERO)], storyCarriers, P);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.distance, 0);
});

test('a carrier the item repeats is still one carrier', () => {
  /* Nothing stops an adapter emitting the same fingerprint twice — a repeated hashtag,
     the same format id read from two fields. A duplicated match would let one carrier
     vote twice in whatever the stage does with this list. */
  const repeated = [format('sound-88213'), format('sound-88213'), span('dock'), span('dock')];
  const matches = carrierMatches(repeated, repeated, P);
  assert.equal(matches.length, 2);
  assert.deepEqual(
    matches.map((m) => m.carrier.key).sort(),
    ['dock', 'sound-88213'],
  );
});

test('matches come back strongest first, so the stage can log matches[0] and stop', () => {
  const corpus: CarrierCorpus = {
    [corpusKey(span('hipposeason'))]: { idf24h: 5, dfByBucket: [0, 0, 80] },
  };
  const item = [span('$SOL'), span('hipposeason'), format('sound-88213')];
  const matches = carrierMatches(item, item, P, corpus);

  assert.equal(matches.length, 3);
  assert.equal(matches[0]?.carrier.key, 'hipposeason');
  assert.equal(matches[2]?.carrier.key, '$SOL');
  assert.equal(matches[2]?.weight, 0);

  /* Which is what makes the M5 rule a one-liner for the stage: if the STRONGEST shared
     carrier is worth nothing, every shared carrier is worth nothing. */
  const onlyGeneric = carrierMatches([span('$SOL')], [span('$SOL')], P);
  assert.equal(onlyGeneric[0]?.weight, 0);
});

test('the order is total, so a replay reproduces the carrier that was written down', () => {
  /* A sort that ties has already stopped being reproducible, and the member row records
     WHICH carrier joined the item. Same inputs in a different order, same answer. */
  const item = [format('bbb'), format('aaa'), span('aaa'), span('bbb')];
  const forward = carrierMatches(item, item, P).map((m) => `${m.carrier.kind} ${m.carrier.key}`);
  const backward = carrierMatches([...item].reverse(), [...item].reverse(), P).map(
    (m) => `${m.carrier.kind} ${m.carrier.key}`,
  );
  assert.deepEqual(forward, backward);
  /* Kind order is the vocabulary's own order, then the key. Both exist only to make the
     comparator total — neither is a judgement about which carrier is better evidence. */
  assert.deepEqual(forward, ['formatId aaa', 'formatId bbb', 'entitySpan aaa', 'entitySpan bbb']);
});

test('an exact carrier outranks a near one at equal weight', () => {
  /* Certainty beats proximity. An exact-match kind has no distance and sorts as if it
     were nearer than zero. */
  const item = [image(IMAGE_ZERO), format('sound-88213')];
  const story = [image(IMAGE_AT_BAR), format('sound-88213')];
  const matches = carrierMatches(item, story, P);
  assert.equal(matches.length, 2);
  assert.equal(matches[0]?.carrier.kind, 'formatId');
  assert.equal(matches[0]?.distance, null);
});
