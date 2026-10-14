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
 *
 * ★ TWO SPELLINGS OF ONE POST. The platform's own item object (`desc`, `author`, `stats`,
 * `video.cover`) and the scraper's flattened one (`text`, `authorMeta`, top-level `playCount`,
 * `videoMeta.coverUrl`, `musicMeta`, `hashtags`) — the configured scraper, recorded 2026-10-13,
 * sends the second. Every read below tries the scraper's field and falls back to the platform's,
 * so either payload becomes the same Item. A field missing under both is null, never zero.
 */

import type { Author, Counter, CounterSet, Fingerprint, Item, MediaRef, Millis } from '@insidor/contracts';
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
  const meta = rec(r.videoMeta);
  const v = Object.keys(meta).length > 0 ? meta : rec(r.video);
  const cover = str(v.coverUrl) ?? str(v.originalCoverUrl) ?? str(v.cover) ?? str(v.originCover);
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
  const music = str(rec(r.musicMeta).musicId) ?? str(rec(r.music).id);
  if (music !== null) out.push(`${SOURCE}:sound:${music}`);
  for (const e of arr(r.effectStickers)) {
    const id = str(rec(e).ID) ?? str(rec(e).id);
    if (id !== null) out.push(`${SOURCE}:effect:${id}`);
  }
  return out;
}

function fingerprints(r: Rec, text: string): readonly Fingerprint[] {
  const out: Fingerprint[] = formatIds(r).map((key) => ({ kind: 'formatId', key }));

  for (const tag of [...arr(r.textExtra), ...arr(r.hashtags)]) {
    const name = str(rec(tag).hashtagName) ?? str(rec(tag).name);
    if (name !== null && name !== '') out.push({ kind: 'entitySpan', key: hashtagKey(name) });
  }

  // Perceptual hashing of the keyframe happens in the media pipeline, not here.
  // Emitting a fake hash would silently poison the free carrier join, which is
  // the grouper's whole basis. Absent is honest; invented is not.
  // Phrases, not a hash: the runner folds them into one SimHash (core/group/text-carrier.ts)
  // before storing, because the hash's weights come from a corpus no adapter can see.
  for (const key of shingles(text)) out.push({ kind: 'textShingle', key });
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
  const r = rec(raw);
  /* The scraper puts the counts on the item itself; the platform nests them under `stats`. */
  const s = Object.keys(rec(r.stats)).length > 0 ? rec(r.stats) : r;
  return {
    reach: counter(num(s.playCount), FIDELITY.reach, at),
    approval: counter(num(s.diggCount), FIDELITY.approval, at),
    conversation: counter(num(s.commentCount), FIDELITY.conversation, at),
    rebroadcast: counter(num(s.shareCount), FIDELITY.rebroadcast, at),
    retention: counter(num(s.collectCount), FIDELITY.retention, at),
  };
}

/* ── the translation ──────────────────────────────────────────────────── */

/** The account object under either spelling: the scraper's `authorMeta` (handle in `name`), or `author`. */
function authorOf(r: Rec): Rec {
  const meta = rec(r.authorMeta);
  return Object.keys(meta).length > 0 ? meta : rec(r.author);
}

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

  const text = str(r.text) ?? str(r.desc) ?? '';
  const author = authorOf(r);

  return {
    itemId: itemId(SOURCE, id),
    source: SOURCE,
    sourceItemId: id,
    origin: 'observed',
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

/**
 * The account behind one post, as the same payload describes it.
 *
 * Keyed as `toItem` keys the post, by the numeric account id. The handle is `uniqueId` —
 * the @name in the post's URL — not `nickname`, which is a display name anybody can set to
 * anything and which appears in no link. Null when the payload names no account id.
 */
export function toAuthor(raw: unknown, at: Millis): Author | null {
  const author = authorOf(rec(raw));
  const id = str(author.id);
  if (id === null) return null;
  const handle = (str(author.uniqueId) ?? str(author.name) ?? '').replace(/^@+/, '').trim();
  /* The scraper's `fans`, or the platform's own `authorStats.followerCount`; the name and picture
     under either spelling. The picture link is signed and expires: the screen falls back to the
     handle's letter when it no longer loads, and the next read of the account renews it. */
  const followers = num(author.fans) ?? num(rec(rec(raw).authorStats).followerCount);
  const name = (str(author.nickName) ?? str(author.nickname) ?? '').trim();
  const picture = str(author.avatar) ?? str(author.avatarMedium) ?? str(author.avatarThumb) ?? str(author.originalAvatarUrl);
  /* The profile text is `signature` under both spellings, with the scraper's `bioLink` (a string or
     `{ link }`) after it, so an address that is only in the link is read too. The newest-first
     search actor sends no signature: its accounts' bios stay unread (null), never blank. */
  const signature = typeof author.signature === 'string' ? author.signature.trim() : null;
  const bioLink = str(author.bioLink) ?? str(rec(author.bioLink).link) ?? str(rec(author.bio_url).link);
  const bio = signature === null && bioLink === null ? null : [signature ?? '', bioLink ?? ''].filter((x) => x !== '').join('\n');
  return {
    authorKey: authorKey(SOURCE, id),
    source: SOURCE,
    firstSeenAt: at,
    handle: handle === '' ? null : handle,
    audience: followers === null ? null : { value: followers, fidelity: { kind: 'exact' }, observedAt: at },
    rosterTier: null,
    displayName: name === '' ? null : name,
    pictureUri: picture !== null && picture.startsWith('https://') ? picture : null,
    bio,
  };
}
