/**
 * The ONLY file in the repository permitted to know this vendor's field names.
 *
 * What it does: shape translation, and an honest fidelity claim per counter.
 * What it never does: threshold, score, filter, decide, or touch the network or
 * the database. If you are tempted to add an `if` that drops an item here, that
 * `if` belongs in core/admit, where it is one line of a policy object and a
 * test rather than a sentence in a vendor file.
 */

import type { Counter, CounterSet, Fingerprint, Item, MediaRef, Millis } from '@insidor/contracts';
import { authorKey, itemId } from '@insidor/contracts/ids.ts';
import { arr, cashtagKey, dateToMillis, hashtagKey, num, rec, shingles, str } from '@insidor/vendor-kit';
import type { Rec } from '@insidor/vendor-kit';

import { FIDELITY, SOURCE } from './capabilities.ts';

/* ── counters ─────────────────────────────────────────────────────────── */

const counter = (value: number | null, fidelity: Counter['fidelity'], at: Millis): Counter => ({
  value,
  fidelity,
  observedAt: at,
});

/**
 * Exported because the tracking path re-reads counters without re-reading the
 * whole item, and there must not be two definitions of which vendor field is
 * which counter kind. One mapping, two callers.
 */
export function toCounters(raw: unknown, at: Millis): CounterSet {
  const r = rec(raw);
  return {
    reach: counter(num(r.viewCount), FIDELITY.reach, at),
    approval: counter(num(r.likeCount), FIDELITY.approval, at),
    conversation: counter(num(r.replyCount), FIDELITY.conversation, at),
    rebroadcast: counter(num(r.retweetCount), FIDELITY.rebroadcast, at),
    // A first-class reproduction COUNT, readable from one snapshot with no
    // corpus join. This source is the only one we have where that is true, and
    // core must treat it as one of two possible paths, never as the definition.
    reproduction: counter(num(r.quoteCount), FIDELITY.reproduction, at),
    retention: counter(num(r.bookmarkCount), FIDELITY.retention, at),
  };
}

/* ── media ────────────────────────────────────────────────────────────── */

function media(r: Rec): readonly MediaRef[] {
  const entries = arr(rec(r.extendedEntities).media);
  const out: MediaRef[] = [];
  for (const entry of entries) {
    const m = rec(entry);
    const uri = str(m.media_url_https) ?? str(m.media_url);
    if (uri === null) continue;
    const size = rec(rec(m.sizes).large);
    out.push({
      kind: str(m.type) === 'video' || str(m.type) === 'animated_gif' ? 'video' : 'image',
      uri,
      width: num(size.w),
      height: num(size.h),
      durationMs: num(rec(m.video_info).duration_millis),
    });
  }
  return out;
}

/* ── carriers ─────────────────────────────────────────────────────────── */

function fingerprints(r: Rec, text: string): readonly Fingerprint[] {
  const out: Fingerprint[] = [];

  // Cashtags and hashtags are entity spans, and their keys carry no source
  // prefix: an unprefixed key is what lets the same span seen on two sources
  // join for free.
  for (const s of arr(rec(r.entities).symbols)) {
    const sym = str(rec(s).text);
    if (sym !== null) out.push({ kind: 'entitySpan', key: cashtagKey(sym) });
  }
  for (const h of arr(rec(r.entities).hashtags)) {
    const tag = str(rec(h).text);
    if (tag !== null) out.push({ kind: 'entitySpan', key: hashtagKey(tag) });
  }
  for (const key of shingles(text)) out.push({ kind: 'textShingle', key, bits: 64 });

  // Perceptual image hashing happens in the media pipeline, after download.
  // Emitting a placeholder hash here would poison the free carrier join, which
  // is the grouper's whole basis. Absent is honest; invented is not.
  return out;
}

/* ── the translation ──────────────────────────────────────────────────── */

/**
 * @param raw  one item from the vendor payload
 * @param at   the instant WE read it, INJECTED. This file never calls a clock:
 *             every item in one response must share one observedAt, and a
 *             recorded fixture must replay to an identical Item.
 */
export function toItem(raw: unknown, at: Millis): Item {
  const r = rec(raw);
  const id = str(r.id) ?? str(r.id_str);
  if (id === null) throw new TypeError('to-item: payload has no item id');

  const text = str(r.text) ?? str(r.full_text) ?? '';
  const author = rec(r.author);

  return {
    itemId: itemId(SOURCE, id),
    source: SOURCE,
    sourceItemId: id,
    // The numeric account id, never the handle: handles are renamed and reused,
    // and an author key that changes is an author we cannot count.
    authorKey: authorKey(SOURCE, str(author.id) ?? str(author.id_str) ?? 'unknown'),

    // Null rather than a guess. postedAt feeds the pre-mint ordering gate, and
    // a confidently wrong timestamp there silently inverts the gate's meaning.
    postedAt: dateToMillis(r.createdAt) ?? dateToMillis(r.created_at),
    firstSeenAt: at,

    lang: str(r.lang),
    text,
    media: media(r),
    counters: toCounters(r, at),
    fingerprints: fingerprints(r, text),

    // A rebroadcast adds ZERO new authorship: it is the same object, re-shown.
    rebroadcastOf: (() => {
      const src = str(rec(r.retweeted_tweet).id);
      return src === null ? null : itemId(SOURCE, src);
    })(),
    // A reproduction adds ONE new authorship: a new object, with a new author,
    // pointing at the old one. Getting these two backwards inverts the signal
    // the product is built on.
    reproductionOf: (() => {
      const src = str(rec(r.quoted_tweet).id) ?? str(r.quoted_status_id_str);
      return src === null ? null : itemId(SOURCE, src);
    })(),

    // This source has no reusable format object — no shared sound, no template
    // id. An empty list is the truthful answer, not a gap to be filled.
    formatIds: [],

    rawRef: `${SOURCE}/${id}.json`,
  };
}
