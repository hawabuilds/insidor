/**
 * The ONLY file in the repository permitted to know this vendor's field names.
 *
 * What this file does: shape translation, and an honest fidelity claim per
 * counter. What it does NOT do, ever: threshold, score, filter, decide, or
 * touch the network or the database. If you are tempted to add an `if` that
 * drops an item here, that `if` belongs in core/admit.
 *
 * The fidelity values were MEASURED against live payloads, not assumed. That is
 * why they differ per field within the same object.
 */

import type { Counter, CounterSet, Fingerprint, Item, MediaRef, Millis } from '@insidor/contracts';
import { authorKey, itemId } from '@insidor/contracts/ids.ts';
import { arr, hashtagKey, num, rec, secondsToMillis, shingles, str } from '@insidor/vendor-kit';
import type { Rec } from '@insidor/vendor-kit';

import { FIDELITY, SOURCE } from './capabilities.ts';

const counter = (value: number | null, fidelity: Counter['fidelity'], at: Millis): Counter => ({
  value,
  fidelity,
  observedAt: at,
});

/* ── media ────────────────────────────────────────────────────────────── */

function media(r: Rec): readonly MediaRef[] {
  const v = rec(r.video);
  const cover = str(v.cover) ?? str(v.originCover);
  if (cover === null) return [];
  const durationS = num(v.duration);
  return [
    {
      kind: 'image',
      uri: cover,
      width: num(v.width),
      height: num(v.height),
      durationMs: durationS === null ? null : durationS * 1000,
    },
  ];
}

/* ── carriers ─────────────────────────────────────────────────────────── */

/**
 * A shared sound or effect is a reusable template, and two posts using the same
 * one are related for free — no hashing, no embedding, no cost. Format ids ARE
 * prefixed with the source, because a sound id means nothing off the platform
 * that issued it. Entity spans and shingles are not, because those must join
 * across sources.
 */
export function formatIds(r: Rec): readonly string[] {
  const out: string[] = [];
  const music = str(rec(r.music).id);
  if (music !== null) out.push(`${SOURCE}:sound:${music}`);
  for (const e of arr(r.effectStickers)) {
    const id = str(rec(e).ID) ?? str(rec(e).id);
    if (id !== null) out.push(`${SOURCE}:effect:${id}`);
  }
  return out;
}

function fingerprints(r: Rec, text: string): readonly Fingerprint[] {
  const out: Fingerprint[] = formatIds(r).map((key) => ({ kind: 'formatId', key }));

  for (const tag of arr(r.textExtra)) {
    const name = str(rec(tag).hashtagName);
    if (name !== null) out.push({ kind: 'entitySpan', key: hashtagKey(name) });
  }

  // Perceptual hashing of the keyframe happens in the media pipeline, not here.
  // Emitting a fake hash would silently poison the free carrier join, which is
  // the grouper's whole basis. Absent is honest; invented is not.
  for (const key of shingles(text)) out.push({ kind: 'textShingle', key, bits: 64 });
  return out;
}

/* ── counters ─────────────────────────────────────────────────────────── */

/**
 * `reproduction` is DELIBERATELY OMITTED, not set to zero. This source exposes
 * no reproduction count; it exposes a lineage pointer on the child item only.
 * `capabilities.absent` declares it, and core derives reproduction from the
 * fingerprint index instead. Writing 0 here would make every item from this
 * source look uncopied, which is the opposite of the truth — and is exactly the
 * live bug this rebuild exists to remove.
 */
export function toCounters(raw: unknown, at: Millis): CounterSet {
  const s = rec(rec(raw).stats);
  return {
    reach: counter(num(s.playCount), FIDELITY.reach, at),
    approval: counter(num(s.diggCount), FIDELITY.approval, at),
    conversation: counter(num(s.commentCount), FIDELITY.conversation, at),
    rebroadcast: counter(num(s.shareCount), FIDELITY.rebroadcast, at),
    retention: counter(num(s.collectCount), FIDELITY.retention, at),
  };
}

/* ── the translation ──────────────────────────────────────────────────── */

/**
 * @param raw  one item from the vendor payload
 * @param at   the instant WE read it, INJECTED. This file never calls a clock:
 *             two items from one response must share one observedAt, and a
 *             recorded fixture must replay to an identical Item.
 */
export function toItem(raw: unknown, at: Millis): Item {
  const r = rec(raw);
  const id = str(r.id) ?? str(r.awemeId);
  if (id === null) throw new TypeError('to-item: payload has no item id');

  const text = str(r.desc) ?? '';
  const author = rec(r.author);

  return {
    itemId: itemId(SOURCE, id),
    source: SOURCE,
    sourceItemId: id,
    // The numeric account id, never the @handle: handles are renamed and reused.
    authorKey: authorKey(SOURCE, str(author.id) ?? 'unknown'),

    // Seconds → millis. Null rather than a guess: postedAt feeds the pre-mint
    // ordering gate, and a confidently wrong timestamp there is worse than none.
    postedAt: secondsToMillis(r.createTime),
    firstSeenAt: at,

    lang: str(r.textLanguage),
    text,
    media: media(r),
    counters: toCounters(r, at),
    fingerprints: fingerprints(r, text),

    // This source has no share-without-authoring object in its item feed.
    rebroadcastOf: null,
    // Stitch and duet BOTH create a new authored object: reproduction, not
    // rebroadcast. Getting this backwards inverts the product's signal.
    reproductionOf: (() => {
      const src = str(rec(r.stitchInfo).sourceId) ?? str(rec(r.duetInfo).sourceId);
      return src === null ? null : itemId(SOURCE, src);
    })(),

    formatIds: formatIds(r),
    rawRef: `${SOURCE}/${id}.json`,
  };
}
