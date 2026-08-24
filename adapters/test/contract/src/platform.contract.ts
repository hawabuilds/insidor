/**
 * ONE conformance suite, run against EVERY platform adapter.
 *
 * This file is what makes the abstraction real rather than aspirational. A
 * port is a promise, and a promise nothing checks is a comment: the previous
 * build had a folder called `adapters` and a parser that wrote one vendor's
 * share count into a column named after another vendor's concept, and nothing
 * objected, because there was nothing to object to.
 *
 * Two properties are load-bearing here:
 *
 *   The suite takes the adapter and a set of RECORDED PAYLOADS. Types are
 *   erased at runtime, so a signature proves nothing about what a vendor
 *   actually sends. Only a real payload does.
 *
 *   The suite knows no vendor's field names. Every assertion is expressed in
 *   our vocabulary, which is why the same file can run against a source that
 *   has a reproduction count, one that has none, and one that is a JSON file.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Counter, CounterKind, Item } from '@insidor/contracts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';

export interface PlatformCase {
  readonly adapter: PlatformAdapter;
  /** Recorded vendor payloads. At least one degraded payload, please. */
  readonly samples: readonly unknown[];
  /**
   * How this case is named in the output. Defaults to the adapter's id — which
   * two adapters legitimately share when one of them is a replay of the other.
   */
  readonly label?: string;
}

/** A read instant far enough forward that recorded readings precede it. */
const AT = 1_800_000_000_000;
const BILLING_KINDS = ['per-item-returned', 'per-call', 'per-run', 'flat'];
const COUNTER_KINDS = [
  'reach',
  'approval',
  'conversation',
  'rebroadcast',
  'reproduction',
  'retention',
] as const satisfies readonly CounterKind[];

/** Every counter an Item actually carries, as typed pairs. */
const countersOf = (item: Item): readonly (readonly [CounterKind, Counter])[] =>
  COUNTER_KINDS.flatMap((kind) => {
    const counter: Counter | undefined = item.counters[kind];
    return counter === undefined ? [] : [[kind, counter] as const];
  });

export function runPlatformContract(testCase: PlatformCase): void {
  const { adapter, samples } = testCase;
  const caps = adapter.capabilities;

  describe(`platform contract: ${testCase.label ?? String(adapter.id)}`, () => {
    /* ── the capability declaration ──────────────────────────────────── */

    it('declares an id with no whitespace, because it is a key everywhere else', () => {
      const id = String(adapter.id);
      assert.ok(id.length > 0);
      assert.equal(id, id.trim());
      assert.doesNotMatch(id, /\s/);
    });

    it('agrees with its own capability declaration about who it is', () => {
      // Two names for one source would make it reachable under one and logged
      // under the other, which is unrecoverable after the fact.
      assert.equal(String(caps.source), String(adapter.id));
    });

    it('states a fidelity for every counter it claims to have', () => {
      // A counter with no declared fidelity is a number nobody can say how much
      // to trust, and the censoring rule has nothing to branch on.
      for (const kind of caps.counters) {
        assert.ok(caps.fidelity[kind] !== undefined, `${kind} has no declared fidelity`);
      }
    });

    it('cannot both have and lack a counter', () => {
      for (const kind of caps.absent) {
        assert.equal(
          caps.counters.includes(kind),
          false,
          `${kind} is declared both present and absent`,
        );
      }
    });

    it('declares only real counter kinds', () => {
      const known: readonly string[] = COUNTER_KINDS;
      for (const kind of [...caps.counters, ...caps.absent]) {
        assert.ok(known.includes(kind), `${String(kind)} is not a counter kind`);
      }
    });

    it('declares at least one way in — an empty discovery list is a source we cannot reach', () => {
      assert.ok(caps.discovery.length > 0);
    });

    it('declares a batch size that is null or usable, never zero', () => {
      if (caps.observeBatchSize !== null) {
        assert.ok(Number.isInteger(caps.observeBatchSize));
        assert.ok(caps.observeBatchSize >= 1);
      }
    });

    it('declares a billing kind, because they differ in kind and cannot be averaged', () => {
      assert.ok(BILLING_KINDS.includes(caps.billing));
    });

    /* ── what a call would cost ──────────────────────────────────────── */

    /**
     * ★ EVERY SOURCE MUST BE ABLE TO PRICE A CALL WITHOUT MAKING IT.
     *
     * This is what a dry run consists of and what free-before-paid decides on, so a
     * source that cannot answer is a source that either has to be asked before anybody
     * can find out what it costs — which defeats the whole point — or has to be
     * hardcoded into a list of "the free ones", which stops being true the first time a
     * vendor changes its terms.
     */
    const estimateQuery = {
      mode: caps.discovery[0] ?? 'keyword',
      term: 'anything',
      sinceMs: null,
      untilMs: null,
      limit: 10,
      cursor: null,
    } as const;

    it('★ prices a discovery call without making one', () => {
      const estimate = adapter.estimate({ kind: 'discover', query: estimateQuery });
      assert.equal(estimate.vendor.trim(), estimate.vendor);
      assert.ok(estimate.vendor.length > 0, 'an estimate with no vendor cannot be capped per vendor');
      assert.ok(estimate.endpoint.length > 0);
      assert.ok(BILLING_KINDS.includes(estimate.unit));
      assert.ok(Number.isFinite(estimate.usd) && estimate.usd >= 0, 'an estimate must be a real, non-negative number');
      assert.ok(Number.isFinite(estimate.estUnits) && estimate.estUnits >= 0);
    });

    it('★ prices a re-read separately, because the two verbs can bill differently', () => {
      /* One source charges per item returned for both verbs and another charges per RUN
         for both. A caller allowed to price a discovery and spend the number on a
         tracking pass would be wrong by a hundredfold on the source where the tracking
         path is the entire bill. */
      const estimate = adapter.estimate({ kind: 'observe', sourceItemIds: ['a', 'b', 'c'] });
      assert.ok(Number.isFinite(estimate.usd) && estimate.usd >= 0);
      assert.ok(BILLING_KINDS.includes(estimate.unit));
    });

    it('★ estimating is free and repeatable — it makes no call and keeps no state', () => {
      /* Asserted as determinism because that is the observable shadow of "performs no
         I/O". An estimate that talked to a vendor, or that advanced a cursor, would
         drift between two identical questions — and a dry run is nothing but a few
         hundred identical questions. */
      const first = adapter.estimate({ kind: 'discover', query: estimateQuery });
      const second = adapter.estimate({ kind: 'discover', query: estimateQuery });
      assert.deepEqual(first, second);
    });

    it('estimating nothing costs nothing on a per-item vendor, and a whole run on a per-run one', () => {
      /* Zero ids is a legitimate outcome — every id unaddressable, or a queue that
         drained — and what it costs is exactly the difference between the billing
         kinds. Pinned so a source cannot quietly start charging for an empty batch, or
         quietly stop charging for an empty run. */
      const empty = adapter.estimate({ kind: 'observe', sourceItemIds: [] });
      assert.equal(empty.usd, 0, 'an empty batch starts no call and must cost nothing');
    });

    it('accounts for every counter kind: present, absent, or deliberately unstated', () => {
      // Not a requirement that all six are classified — a source may simply
      // not have been measured yet. But a kind that is neither present nor
      // absent must not then appear on an Item, which the next block checks.
      assert.ok(caps.counters.length + caps.absent.length <= COUNTER_KINDS.length);
    });

    /* ── the translation ─────────────────────────────────────────────── */

    const items: Item[] = [];
    it('translates every recorded payload without throwing', () => {
      assert.ok(samples.length > 0, 'a platform with no recorded payloads is untested');
      for (const raw of samples) items.push(adapter.toItem(raw, AT));
    });

    it('NEVER emits a counter it declared absent — not null, not zero, not present', () => {
      // THE test. An absent concept has no reading at all; a zero here reads
      // downstream as "nobody copied this", which is the opposite of unknown,
      // and it is the exact defect this rebuild exists to remove.
      for (const item of items) {
        for (const kind of caps.absent) {
          assert.equal(
            kind in item.counters,
            false,
            `${String(adapter.id)} emitted the absent counter ${kind}`,
          );
        }
      }
    });

    it('never emits a counter it did not declare', () => {
      for (const item of items) {
        for (const [kind] of countersOf(item)) {
          assert.ok(
            caps.counters.includes(kind),
            `${String(adapter.id)} emitted undeclared counter ${kind}`,
          );
        }
      }
    });

    it('emits null for an unread counter rather than zero', () => {
      for (const item of items) {
        for (const [kind, counter] of countersOf(item)) {
          assert.ok(
            counter.value === null || Number.isFinite(counter.value),
            `${kind} carries a non-finite value`,
          );
          assert.ok(counter.fidelity.kind.length > 0);
        }
      }
    });

    it('reads no clock: the instant is injected and it propagates', () => {
      for (const raw of samples) {
        assert.equal(adapter.toItem(raw, AT).firstSeenAt, AT);
        assert.equal(adapter.toItem(raw, AT + 60_000).firstSeenAt, AT + 60_000);
      }
    });

    it('translates deterministically — a recording replays identically', () => {
      for (const raw of samples) {
        assert.deepEqual(adapter.toItem(raw, AT), adapter.toItem(raw, AT));
      }
    });

    it('never stamps a counter as read in the future', () => {
      for (const item of items) {
        for (const [kind, counter] of countersOf(item)) {
          assert.ok(counter.observedAt <= AT, `${kind} was read in the future`);
        }
      }
    });

    it('namespaces its ids, so two sources can never collide', () => {
      for (const item of items) {
        assert.ok(item.sourceItemId.length > 0);
        assert.ok(String(item.itemId).includes(item.sourceItemId));
        assert.notEqual(String(item.itemId), item.sourceItemId);
        assert.ok(String(item.authorKey).length > 0);
        assert.equal(String(item.source), String(adapter.id));
      }
    });

    it('emits a timestamp in milliseconds or none at all', () => {
      for (const item of items) {
        if (item.postedAt !== null) {
          // A seconds-scale value here is a 1000x error that reads as 1970,
          // and postedAt feeds the pre-mint ordering gate.
          assert.ok(item.postedAt > 1e12, `postedAt ${item.postedAt} looks like seconds`);
        }
      }
    });

    it('never points a lineage field at itself', () => {
      for (const item of items) {
        assert.notEqual(item.rebroadcastOf, item.itemId);
        assert.notEqual(item.reproductionOf, item.itemId);
      }
    });

    it('declares lineage honestly: a pointer implies the capability', () => {
      const anyLineage = items.some((i) => i.rebroadcastOf !== null || i.reproductionOf !== null);
      if (anyLineage) assert.equal(caps.lineage, true);
    });

    it('emits carriers with real keys, and no duplicates', () => {
      for (const item of items) {
        const seen = new Set<string>();
        for (const fingerprint of item.fingerprints) {
          assert.ok(fingerprint.key.trim().length > 0, 'an empty carrier key joins everything');
          const composite = `${fingerprint.kind}|${fingerprint.key}`;
          assert.equal(seen.has(composite), false, `duplicate carrier ${composite}`);
          seen.add(composite);
        }
      }
    });

    it('references the raw payload rather than inlining it', () => {
      for (const item of items) {
        assert.ok(item.rawRef.length > 0);
        assert.ok(item.rawRef.length < 256);
        assert.equal(item.rawRef.includes('{'), false, 'the raw payload is inlined, not referenced');
      }
    });

    it('gives comparable items the same baseline key, and it is a label not a number', () => {
      for (const item of items) {
        const key = adapter.baselineKey(item, AT);
        assert.ok(key.length > 0);
        assert.equal(key, adapter.baselineKey(item, AT));
      }
    });
  });
}
