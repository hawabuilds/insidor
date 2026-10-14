/**
 * The ONLY file in the repository permitted to know this vendor's field names.
 *
 * What it does: shape translation, and an honest fidelity claim per counter.
 * What it never does: threshold, score, filter, decide, or touch the network or
 * the database. If you are tempted to add an `if` that drops an item here, that
 * `if` belongs in core/admit, where it is one line of a policy object and a
 * test rather than a sentence in a vendor file.
 */

import type { Author, Counter, CounterSet, Fingerprint, Item, MediaRef, Millis } from '@insidor/contracts';
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

/**
 * The bitrate a phone plays a post's video at: the best mp4 at or under it, else the smallest.
 * The vendor lists every rendition; the largest is several megabits a second, which a phone on a
 * mobile network stalls on, and the smallest is too soft to read a caption in.
 */
const PLAY_BITRATE_MAX = 2_200_000;

/**
 * The video's own mp4, when the vendor lists one. These files are served unsigned and play in a
 * page's video element as they are, so the post sheet plays the post in the app. A stream
 * playlist (m3u8) is skipped: a page cannot play one without a player library.
 */
export function playUriOf(videoInfo: unknown): string | null {
  const mp4 = arr(rec(videoInfo).variants)
    .map((v) => rec(v))
    .flatMap((v) => {
      const url = str(v.url);
      return url !== null && str(v.content_type) === 'video/mp4' && url.startsWith('https://') ? [{ url, bitrate: num(v.bitrate) ?? 0 }] : [];
    })
    .sort((a, b) => a.bitrate - b.bitrate);
  const fits = mp4.filter((v) => v.bitrate <= PLAY_BITRATE_MAX);
  return (fits[fits.length - 1] ?? mp4[0])?.url ?? null;
}

function media(r: Rec): readonly MediaRef[] {
  const entries = arr(rec(r.extendedEntities).media);
  const out: MediaRef[] = [];
  for (const entry of entries) {
    const m = rec(entry);
    const uri = str(m.media_url_https) ?? str(m.media_url);
    if (uri === null) continue;
    const size = rec(rec(m.sizes).large);
    /* A GIF here is an mp4 with no sound and no length: kept as a video with its file, and
       marked `loops` so the post sheet plays it like the moving picture it is. */
    const gif = str(m.type) === 'animated_gif';
    const video = str(m.type) === 'video' || gif;
    const playUri = video ? playUriOf(m.video_info) : null;
    out.push({
      kind: video ? 'video' : 'image',
      uri,
      width: num(size.w),
      height: num(size.h),
      durationMs: num(rec(m.video_info).duration_millis),
      ...(playUri === null ? {} : { playUri }),
      ...(gif ? { loops: true } : {}),
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
  // Phrases, not a hash: the runner folds them into one SimHash (core/group/text-carrier.ts)
  // before storing, because the hash's weights come from a corpus no adapter can see.
  for (const key of shingles(text)) out.push({ kind: 'textShingle', key });

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
    origin: 'observed',
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

/**
 * The account behind one post, as the same payload describes it.
 *
 * Keyed exactly as `toItem` keys the post — the numeric account id — so the two rows meet.
 * The handle is `userName`, the name in the post's URL; a leading '@' is stripped here,
 * once, because a stored sigil would put it in the link. Null when the payload names no
 * account id: an author we cannot key is not a row worth writing.
 */
export function toAuthor(raw: unknown, at: Millis): Author | null {
  const author = rec(rec(raw).author);
  const id = str(author.id) ?? str(author.id_str);
  if (id === null) return null;
  const handle = (str(author.userName) ?? str(author.screen_name) ?? '').replace(/^@+/, '').trim();
  /* The follower count and the account's name and picture ride on every post the search returns:
     stored with the read's instant, so a count is never shown without when it was true. */
  const followers = num(author.followers) ?? num(author.followers_count);
  const name = (str(author.name) ?? '').trim();
  const picture = str(author.profilePicture) ?? str(author.profile_image_url_https) ?? str(author.profile_image_url);
  /* The profile text is `profile_bio.description` (the flat `description` came back empty on every
     post measured, responses.ts), with its links written out: the text carries them shortened, and
     an address in a link is only in the expanded form. Null when neither field came back. */
  const bioRec = rec(author.profile_bio);
  const said = [bioRec.description, author.description].find((d): d is string => typeof d === 'string' && d.trim() !== '') ?? [bioRec.description, author.description].find((d): d is string => typeof d === 'string');
  const bioText = said === undefined ? null : said.trim();
  const ents = rec(bioRec.entities);
  const links = [...arr(rec(ents.description).urls), ...arr(rec(ents.url).urls)].map((u) => str(rec(u).expanded_url)).filter((u): u is string => u !== null);
  const bio = bioText === null && links.length === 0 ? null : [bioText ?? '', ...links].filter((x) => x !== '').join('\n');
  return {
    authorKey: authorKey(SOURCE, id),
    source: SOURCE,
    firstSeenAt: at,
    handle: handle === '' ? null : handle,
    audience: followers === null ? null : { value: followers, fidelity: { kind: 'exact' }, observedAt: at },
    rosterTier: null,
    displayName: name === '' ? null : name,
    /* The vendor hands the 48px rendition (`_normal`); the owner asked for the 400px one (2026-10-13),
       the same picture, sharp at any size the app draws it. */
    pictureUri: picture !== null && picture.startsWith('https://') ? picture.replace(/_normal(\.[a-z]+)$/i, '_400x400$1') : null,
    bio,
  };
}
