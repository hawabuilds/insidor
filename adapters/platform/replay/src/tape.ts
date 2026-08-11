/**
 * A tape: recorded items and the successive counter readings taken from them.
 *
 * Record once, replay forever, and THROW ON A MISS. A replay that quietly
 * returns nothing for an unrecorded id is worse than no replay at all — the
 * test passes, the gap is invisible, and the recording rots without anyone
 * being told.
 *
 * The tape decodes every field it hands out. Types are erased at runtime, so a
 * JSON file on disk is exactly as untrusted as a vendor response, and a tape
 * edited by hand is the most likely source of a malformed one.
 */

import type { Counter, CounterKind, CounterSet, Fidelity, Fingerprint, Item, MediaRef, Millis } from '@insidor/contracts';
import { sourceId } from '@insidor/contracts/ids.ts';
import type { AuthorKey, ItemId, SourceId } from '@insidor/contracts/ids.ts';
import type { Capabilities } from '@insidor/contracts/ports/platform.ts';
import { arr, num, rec, str, VendorShapeError } from '@insidor/vendor-kit';
import type { Rec } from '@insidor/vendor-kit';

export interface TapeReading {
  /** The source's own id, because that is what `observe` is called with. */
  readonly sourceItemId: string;
  readonly capturedAt: Millis;
  readonly counters: CounterSet;
}

export interface Tape {
  readonly source: SourceId;
  readonly recordedAt: Millis;
  /**
   * Copied from the adapter that produced the recording. A replay must not
   * claim a capability the recording cannot honour — that is how a fixture
   * starts testing a path the real source does not have.
   */
  readonly capabilities: Capabilities;
  readonly items: readonly Item[];
  readonly readings: readonly TapeReading[];
}

export class TapeMiss extends Error {
  readonly sourceItemId: string;

  constructor(sourceItemId: string) {
    super(`tape has no recording for ${sourceItemId} — re-record rather than returning nothing`);
    this.name = 'TapeMiss';
    this.sourceItemId = sourceItemId;
  }
}

const VENDOR = 'replay';

const required = <T>(v: T | null | undefined, field: string): T => {
  if (v === null || v === undefined) throw new VendorShapeError(VENDOR, field, 'is missing');
  return v;
};

const COUNTER_KINDS: readonly CounterKind[] = [
  'reach',
  'approval',
  'conversation',
  'rebroadcast',
  'reproduction',
  'retention',
];

const FIDELITY_KINDS = ['exact', 'quantized', 'fuzzed', 'absent'] as const;

function decodeFidelity(raw: unknown, field: string): Fidelity {
  const r = rec(raw);
  const kind = str(r.kind);
  if (kind === 'exact') return { kind: 'exact' };
  if (kind === 'fuzzed') return { kind: 'fuzzed' };
  if (kind === 'absent') return { kind: 'absent' };
  if (kind === 'quantized') {
    const digits = num(r.significantDigits);
    if (digits === null) throw new VendorShapeError(VENDOR, field, 'is quantized with no significantDigits');
    return { kind: 'quantized', significantDigits: digits };
  }
  throw new VendorShapeError(VENDOR, field, `has fidelity ${String(kind)}, expected one of ${FIDELITY_KINDS.join('|')}`);
}

function decodeCounter(raw: unknown, field: string): Counter {
  const r = rec(raw);
  // `value` may legitimately be null — "we did not read it" is a real state.
  const value = 'value' in r ? num(r.value) : null;
  const observedAt = required(num(r.observedAt), `${field}.observedAt`);
  const counter: Counter = { value, fidelity: decodeFidelity(r.fidelity, `${field}.fidelity`), observedAt };
  const lag = num(r.lagMs);
  return lag === null ? counter : { ...counter, lagMs: lag };
}

export function decodeCounterSet(raw: unknown, field: string): CounterSet {
  const r = rec(raw);
  const out: { -readonly [K in CounterKind]?: Counter } = {};
  for (const key of Object.keys(r)) {
    const kind = COUNTER_KINDS.find((k) => k === key);
    if (kind === undefined) {
      throw new VendorShapeError(VENDOR, `${field}.${key}`, 'is not a counter kind');
    }
    // An absent concept is an absent KEY. A recording that carries a counter
    // for a kind the source does not have is a broken recording, and the
    // capability check below is what catches it.
    out[kind] = decodeCounter(r[key], `${field}.${key}`);
  }
  return out;
}

function decodeMedia(raw: unknown): readonly MediaRef[] {
  return arr(raw).map((entry, i) => {
    const m = rec(entry);
    const kind = str(m.kind);
    if (kind !== 'image' && kind !== 'video' && kind !== 'audio') {
      throw new VendorShapeError(VENDOR, `media[${i}].kind`, `is ${String(kind)}`);
    }
    return {
      kind,
      uri: required(str(m.uri), `media[${i}].uri`),
      width: num(m.width),
      height: num(m.height),
      durationMs: num(m.durationMs),
    };
  });
}

function decodeFingerprints(raw: unknown): readonly Fingerprint[] {
  return arr(raw).map((entry, i) => {
    const f = rec(entry);
    const kind = str(f.kind);
    if (kind !== 'imageHash' && kind !== 'textShingle' && kind !== 'formatId' && kind !== 'entitySpan') {
      throw new VendorShapeError(VENDOR, `fingerprints[${i}].kind`, `is ${String(kind)}`);
    }
    const bits = num(f.bits);
    const base: Fingerprint = { kind, key: required(str(f.key), `fingerprints[${i}].key`) };
    return bits === null ? base : { ...base, bits };
  });
}

/**
 * @param at the instant the REPLAY read it. Everything else comes off the tape
 *           verbatim, including each counter's original observedAt — those are
 *           the readings kinetics is being replayed against and rewriting them
 *           would destroy the thing under test.
 */
export function decodeItem(raw: unknown, at: Millis): Item {
  const r: Rec = rec(raw);
  const sourceItemId = required(str(r.sourceItemId), 'sourceItemId');
  return {
    itemId: required(str(r.itemId), 'itemId') as ItemId,
    source: required(str(r.source), 'source') as SourceId,
    sourceItemId,
    authorKey: required(str(r.authorKey), 'authorKey') as AuthorKey,
    postedAt: num(r.postedAt),
    firstSeenAt: at,
    lang: str(r.lang),
    text: str(r.text) ?? '',
    media: decodeMedia(r.media),
    counters: decodeCounterSet(r.counters, 'counters'),
    fingerprints: decodeFingerprints(r.fingerprints),
    rebroadcastOf: (str(r.rebroadcastOf) ?? null) as ItemId | null,
    reproductionOf: (str(r.reproductionOf) ?? null) as ItemId | null,
    formatIds: arr(r.formatIds).map((f, i) => required(str(f), `formatIds[${i}]`)),
    rawRef: required(str(r.rawRef), 'rawRef'),
  };
}

function decodeCapabilities(raw: unknown, source: SourceId): Capabilities {
  const c = rec(raw);
  const kinds = (field: string, v: unknown): readonly CounterKind[] =>
    arr(v).map((k, i) => {
      const found = COUNTER_KINDS.find((valid) => valid === str(k));
      if (found === undefined) throw new VendorShapeError(VENDOR, `${field}[${i}]`, `is ${String(k)}`);
      return found;
    });

  const fidelityRaw = rec(c.fidelity);
  const fidelity: { -readonly [K in CounterKind]?: Fidelity } = {};
  for (const key of Object.keys(fidelityRaw)) {
    const kind = COUNTER_KINDS.find((k) => k === key);
    if (kind === undefined) throw new VendorShapeError(VENDOR, `capabilities.fidelity.${key}`, 'is not a counter kind');
    fidelity[kind] = decodeFidelity(fidelityRaw[key], `capabilities.fidelity.${key}`);
  }

  return {
    source,
    counters: kinds('capabilities.counters', c.counters),
    absent: kinds('capabilities.absent', c.absent),
    fidelity,
    discovery: arr(c.discovery) as Capabilities['discovery'],
    observeBatchSize: num(c.observeBatchSize),
    lineage: c.lineage === true,
    billing: required(str(c.billing), 'capabilities.billing') as Capabilities['billing'],
  };
}

export function decodeTape(raw: unknown, at: Millis): Tape {
  const t = rec(raw);
  const source = sourceId(required(str(t.source), 'source'));
  const capabilities = decodeCapabilities(t.capabilities, source);

  const items = arr(t.items).map((i) => decodeItem(i, at));
  const readings = arr(t.readings).map((entry, i) => {
    const r = rec(entry);
    return {
      sourceItemId: required(str(r.sourceItemId), `readings[${i}].sourceItemId`),
      capturedAt: required(num(r.capturedAt), `readings[${i}].capturedAt`),
      counters: decodeCounterSet(r.counters, `readings[${i}].counters`),
    };
  });

  const tape: Tape = {
    source,
    recordedAt: required(num(t.recordedAt), 'recordedAt'),
    capabilities,
    items,
    readings,
  };
  assertTapeHonoursCapabilities(tape);
  return tape;
}

/**
 * A recording that carries a counter its own capability list calls absent is
 * the failure this whole layer exists to prevent, arriving through the back
 * door. Checked at load, not at use.
 */
export function assertTapeHonoursCapabilities(tape: Tape): void {
  const check = (counters: CounterSet, where: string): void => {
    for (const kind of tape.capabilities.absent) {
      if (kind in counters) {
        throw new VendorShapeError(VENDOR, where, `carries ${kind}, which this source declares absent`);
      }
    }
    for (const key of Object.keys(counters)) {
      if (!tape.capabilities.counters.includes(key as CounterKind)) {
        throw new VendorShapeError(VENDOR, where, `carries ${key}, which this source does not declare`);
      }
    }
  };

  for (const item of tape.items) check(item.counters, `items[${item.sourceItemId}].counters`);
  for (const r of tape.readings) check(r.counters, `readings[${r.sourceItemId}].counters`);
}

/** Readings for one id, oldest first. Throws when the id was never recorded. */
export function readingsFor(tape: Tape, sourceItemId: string): readonly TapeReading[] {
  const known = tape.items.some((i) => i.sourceItemId === sourceItemId);
  if (!known) throw new TapeMiss(sourceItemId);
  return tape.readings
    .filter((r) => r.sourceItemId === sourceItemId)
    .slice()
    .sort((a, b) => a.capturedAt - b.capturedAt);
}
