/**
 * The ONLY file in the repository permitted to know this vendor's field names.
 *
 * What it does: shape translation, an honest fidelity claim per counter, and
 * the bounding of strings a stranger wrote. What it never does: threshold,
 * score, filter, decide, or touch the network, a clock or the database. If you
 * are tempted to add an `if` that drops an item here, that `if` belongs in
 * core/admit, where it is one line of a policy object and a test rather than a
 * sentence in a vendor file.
 *
 * ── THE FIELDS, AND FOUR OF THEM ARE TRAPS ────────────────────────────────
 *
 * `ups` IS NOT A SECOND READING OF THE VOTE COUNT. This vendor's serialiser
 * emits `"ups": item.score` — literally the same number under a second name.
 * Reading both and differencing them would produce a beautifully stable zero
 * that means nothing at all. One of them is read, and only as a fallback for
 * the other.
 *
 * `downs` IS A STRUCTURAL ZERO. The serialiser emits `"downs": 0` as a literal,
 * because the concept was withdrawn years ago and the field was kept for
 * compatibility. It is the exact anti-pattern this rebuild exists to remove — a
 * zero where the concept does not exist — and it is never read. There is no
 * counter kind for it either, deliberately: `approval` is one-directional by
 * name and inventing its opposite is not on the table.
 *
 * `hide_score` IS REAL, AND IT LANDS ON THE MOST INTERESTING POSTS. For roughly
 * the first two hours of a post's life this vendor deliberately withholds the
 * score from ordinary readers and sets this flag. A withheld score arrives as
 * whatever placeholder the serialiser felt like — frequently a plausible small
 * integer — so the flag, not the number, is the fact. When it is set the
 * `approval` counter carries `value: null`: not read this time. Writing the
 * placeholder through would put a fabricated vote count on precisely the
 * youngest posts, which are the only ones this product is looking at.
 *
 * `saved` IS ABOUT US, NOT ABOUT THE ITEM. It is a boolean saying whether the
 * account we authenticated as has saved this post. It is not a save count and
 * it is not `retention` — see capabilities.ts.
 *
 * ── EVERY STRING HERE WAS WRITTEN BY A STRANGER ───────────────────────────
 *
 * Two consequences that shape most of the code below. First, a REMOVED post
 * keeps its id and its counters and replaces its body with `[removed]`, and a
 * deleted one with `[deleted]`. Those are STATES, not content: shingled they
 * would make every removed post on the platform a near-duplicate of every other
 * one, which is a carrier that joins unrelated stories for free — the exact
 * inverse of what a carrier is for. They are recognised and dropped.
 *
 * Second, nothing about the length or the content of a text field is our
 * choice. A body here may be forty thousand characters; shingled at five words
 * that is thousands of carrier keys for one post, every one of them stored and
 * indexed. So the text this file EMITS is bounded. That is not a policy
 * decision that belongs in core — core decides what an item MEANS, and this is
 * the edge deciding how much of a hostile input it will carry at all, which is
 * exactly what an edge is for.
 */

import type { Counter, CounterSet, Fingerprint, Item, MediaRef, Millis } from '@insidor/contracts';
import { authorKey, itemId } from '@insidor/contracts/ids.ts';
import { arr, bool, num, rec, secondsToMillis, shingles, str } from '@insidor/vendor-kit';
import type { Rec } from '@insidor/vendor-kit';

import { FIDELITY, SOURCE } from './capabilities.ts';
import { isBareId, isFullname, LINK_KIND } from './client.ts';

/* ── bounds on hostile input ──────────────────────────────────────────── */

/**
 * How much of a post's text we carry.
 *
 * ★ AN ASSUMPTION, AND SAID TO BE ONE. It is not measured against anything: it
 * is a judgement that the first thousand-odd characters of a post are where a
 * reproduced sentence lives, traded against the carrier index paying for every
 * five-word window past that. A title on this source is capped at 300
 * characters by the vendor, so a title always survives in full and the bound
 * only ever bites into a long body. If it turns out to be wrong the symptom is
 * specific and findable — long posts failing to join stories they belong to —
 * which is why it is one named constant rather than an inline slice.
 */
const MAX_TEXT_CHARS = 1_200;

/** A media list is a list of things a stranger attached. Four is generous. */
const MAX_MEDIA = 4;

/** Long enough for any real asset URL, short enough not to be a payload. */
const MAX_URI_CHARS = 2_048;

/**
 * The two strings this vendor substitutes for a body it will not show. Matched
 * exactly rather than by inclusion: a post whose actual text is "this comment
 * was [removed] by the mods" is content, and dropping it would be us editing.
 */
const SENTINELS: ReadonlySet<string> = new Set(['[removed]', '[deleted]']);

/**
 * The username of an account that no longer exists. It is not a handle and it
 * is not one person: every deleted account on the platform answers to it.
 */
const DELETED_AUTHOR = '[deleted]';

/**
 * The sentinel every source in this repository uses for an author it could not
 * identify. Deliberately the same string the other adapters use rather than
 * something clever, so the collapse is consistent and visible in one query.
 */
const UNKNOWN_AUTHOR = 'unknown';

/* ── counters ─────────────────────────────────────────────────────────── */

const counter = (value: number | null, fidelity: Counter['fidelity'], at: Millis): Counter => ({
  value,
  fidelity,
  observedAt: at,
});

/**
 * ★ FOUR OF THE SIX COUNTER KINDS ARE NOT HERE, AND THAT IS THE POINT.
 *
 * `reach`, `rebroadcast`, `reproduction` and `retention` are declared absent in
 * capabilities.ts and are omitted from this object entirely — no key, not even
 * with an undefined value. The conformance suite asserts `kind in
 * item.counters === false`, so writing `reach: undefined` fails it, which is
 * the strictness the suite was written for: `undefined` survives a `?.value`
 * and reappears downstream as a number-shaped hole that some `?? 0` will fill.
 *
 * Exported because the tracking path re-reads counters without re-reading the
 * whole item, and there must not be two definitions of which vendor field is
 * which counter kind. One mapping, two callers.
 */
export function toCounters(raw: unknown, at: Millis): CounterSet {
  const r = rec(raw);

  /* The score is withheld on young posts and the flag is the fact, not the
     number that arrives alongside it. `bool` returns null when the field is
     absent, and only an explicit `true` withholds — an absent flag on an older
     payload must not make every score unreadable. */
  const withheld = bool(r.hide_score) === true;

  return {
    // `score` first, `ups` only as a fallback: they are the same number under
    // two names, so this is a spelling fallback and never a second reading.
    approval: counter(withheld ? null : (num(r.score) ?? num(r.ups)), FIDELITY.approval, at),
    // Every comment in the thread, not just direct replies. A different
    // denominator from another source's conversation counter, which needs no
    // reconciliation: a counter is only ever compared against itself.
    conversation: counter(num(r.num_comments), FIDELITY.conversation, at),
  };
}

/* ── identity ─────────────────────────────────────────────────────────── */

/**
 * The id we store, which is the FULLNAME (`t3_1a2b3c`) rather than the bare
 * base-36 id.
 *
 * The choice is forced and it is worth stating once: the batch lookup endpoint
 * takes fullnames, the permalink takes the bare id, and the seed already holds
 * fullnames. Holding the fullname means `observe` is a straight pass-through
 * and exactly one place — `permalink.ts` — has to strip a prefix. Holding the
 * bare id would mean re-adding a prefix on every re-read, which is the same
 * conversion in the more frequently travelled direction.
 *
 * The fallback derives the fullname from the bare id, and it is safe because
 * this adapter only ever reads link listings — the client drops any child of
 * another kind before this file sees it.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ BOTH FIELDS ARE CHECKED, BECAUSE THIS STRING IS A PATH IN THREE PLACES.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `communityOf` below is sanitised, with a comment explaining that a vendor
 * string landing in `rawRef` could address a different object. The fullname
 * lands in the SAME KEY, one segment along, and used to be taken on trust — so
 * `name: 't3_x/../../../../etc/passwd'` produced the storage key
 * `reddit/aww/t3_x/../../../../etc/passwd.json`. Half a defence is not one.
 *
 * It is worse than that, and the second half is the reason this is not merely
 * tidy-up. The same string is stored as `sourceItemId`, and `sourceItemId` is
 * one of the two facts the projector hands to `permalink.ts` to build a
 * CITATION. The projector's gate is `/^[A-Za-z0-9._~-]+$/`, which admits `.` —
 * so a payload whose `name` is `..` produced `reddit.com/comments/..`, which a
 * browser normalises to the site's front page. That is the specific failure
 * `services/project/src/permalinks.ts` calls the worst thing an evidence list
 * can do: not a citation that goes nowhere, but one that goes SOMEWHERE WRONG,
 * cleanly, under a claim we made.
 *
 * `assertToken` in contracts catches only `:` and `|`, because it is defending
 * the id GRAMMAR and knows nothing about paths. Nothing else was looking.
 *
 * So `name` is used only when it is a fullname of this source's link kind, and
 * `id` only when it is a bare base-36 id. Neither can hold a `/`, a `.` or a
 * space, which is every character that changes what a path or a URL means. A
 * payload satisfying neither has no id we can use, and falls into the throw
 * below — the same answer this file already gave to a payload with no id at
 * all, and for the same reason: an id we did not mint is not one we can repair
 * by guessing, and minting a plausible wrong one is how a citation lies.
 *
 * Note the kind is pinned to links here as well as in the client. The client
 * drops a child whose ENVELOPE says `t1`; this catches a payload whose envelope
 * says `t3` and whose own `name` disagrees, which is the same defect arriving
 * one layer deeper — and `toItem` is a public port method that anything may call
 * with any payload at all.
 */
function fullnameOf(r: Rec): string | null {
  const name = str(r.name);
  if (name !== null && isFullname(name)) return name;
  const id = str(r.id);
  return id !== null && isBareId(id) ? `${LINK_KIND}_${id}` : null;
}

/**
 * ★ THIS SOURCE IS THE ONE PLACE A DISPLAY NAME IS ALSO A STABLE ID, AND IT IS
 * WORTH SAYING WHY WE ARE NOT BREAKING THE RULE.
 *
 * The vocabulary's rule is that an author is keyed by something that survives a
 * rename, "because handles get renamed and reused". On this platform they are
 * not: an account's username is fixed at creation and cannot be changed, and a
 * deleted one is retired rather than released. The username therefore IS the
 * stable id here, and the rule's reason does not apply.
 *
 * The modern payload also carries an opaque account id (`author_fullname`), and
 * it is deliberately NOT preferred over the username. Preferring it "when
 * present" would mint two different keys for one account depending on which
 * endpoint answered — a duplicate author that no query would ever reveal —
 * which is a worse failure than the one it would be guarding against, and the
 * one it guards against cannot happen here.
 *
 * `[deleted]` collapses to the shared unknown sentinel. It is not a username:
 * it is what every deleted account answers to, so keying on it would join
 * unrelated posts under one prolific-looking author. Collapsing them into the
 * same sentinel every other source uses does not fix that — it relocates it —
 * and it is chosen because the alternative, minting a distinct fake id per
 * post, invents an author identity out of nothing. The honest reading of a
 * deleted account is that we do not know who posted this.
 */
function stableAuthorId(r: Rec): string {
  const author = str(r.author);
  if (author === null || author === DELETED_AUTHOR) return UNKNOWN_AUTHOR;
  return author;
}

/* ── the storage key, which is also the cohort ────────────────────────── */

/**
 * The community a post was made in, if the payload names one we can put in a
 * path.
 *
 * Sanitised rather than trusted: this is a vendor string, it ends up inside
 * `rawRef`, and `rawRef` is a storage key. A value containing `/` or `..`
 * would address a different object; a value containing `{` fails the
 * conformance suite outright. The vendor's own rule for these names is letters,
 * digits and underscores, up to 21 characters — anything else is not a
 * community name and is treated as though the field were absent.
 */
const COMMUNITY = /^[A-Za-z0-9_]{1,32}$/;

export function communityOf(raw: unknown): string | null {
  const name = str(rec(raw).subreddit);
  return name !== null && COMMUNITY.test(name) ? name : null;
}

/**
 * ★ THE STORAGE KEY CARRIES THE COMMUNITY, AND `baselineKey` READS IT BACK.
 *
 * That coupling is deliberate, and it is the honest answer to a real problem
 * rather than a trick. The cohort an item's numbers should be compared against
 * on this source is overwhelmingly the COMMUNITY it was posted in: a thread
 * with forty comments is enormous in one place and invisible in another, and
 * comparing across them is comparing nothing. But `Item` carries no per-source
 * context field, deliberately — adding one would put this platform's word in
 * the shared vocabulary, which is the one thing the vocabulary gate exists to
 * prevent — so `baselineKey`, which is handed only an `Item`, cannot see it.
 *
 * The two routes that look available are both worse:
 *   - `formatIds` is what the other adapter smuggles its cohort through, and it
 *     works there because a shared sound genuinely IS a reusable template.
 *     A community is not. core reads `item.formatIds.length` as a feature
 *     ("this post uses a template") and the store puts a GIN index on the
 *     column, so a community id there would both inflate a feature for every
 *     post from this source and turn "posted in the same place" into a carrier
 *     join across thousands of unrelated items.
 *   - Passing a lookup function in through the adapter's deps, as the other
 *     adapter does for handles, would make the cohort depend on state nothing
 *     currently populates — a cohort that is always the fallback, dressed up as
 *     one that is not.
 *
 * `rawRef` is this package's own opaque string, and organising a blob store by
 * community is what one would do anyway. So the community rides in the storage
 * key, and BOTH DIRECTIONS ARE DEFINED HERE, in one pair of functions with one
 * round-trip test, so that the layout and the reader cannot drift apart. If the
 * layout ever changes, it changes in this file and `baselineKey` changes with
 * it or the test fails.
 */
export function rawRefFor(community: string | null, fullname: string): string {
  return community === null ? `${SOURCE}/${fullname}.json` : `${SOURCE}/${community}/${fullname}.json`;
}

/** The inverse. Null for the community-less form, and for anything unexpected. */
export function communityOfRawRef(rawRef: string): string | null {
  const parts = rawRef.split('/');
  if (parts.length !== 3 || parts[0] !== String(SOURCE)) return null;
  const community = parts[1];
  return community !== undefined && COMMUNITY.test(community) ? community : null;
}

/* ── text ─────────────────────────────────────────────────────────────── */

/** A body the vendor replaced with a state marker is not a body. */
function bodyOf(r: Rec): string | null {
  const selftext = str(r.selftext);
  if (selftext === null) return null;
  return SENTINELS.has(selftext.trim().toLowerCase()) ? null : selftext;
}

/**
 * ★ THE BOUND IS COUNTED IN UTF-16 UNITS AND TEXT IS MADE OF CODE POINTS, WHICH
 * IS A DIFFERENCE THIS SOURCE WILL FIND FOR US ON ROUGHLY THE FIRST DAY.
 *
 * `slice(0, 1200)` cuts between the two halves of a surrogate pair whenever the
 * 1,200th unit is the first half of one — an emoji, which on this source is not
 * an edge case but a Tuesday. What comes out is a string containing a LONE
 * SURROGATE: `isWellFormed()` returns false, it is not encodable as UTF-8 at
 * all, and so it does not survive the trip to a `text` column intact. It is not
 * loud about it either. The driver substitutes U+FFFD, so the symptom is one
 * corrupted character at the end of some long posts and a final shingle key that
 * silently cannot match the same sentence carried by any other source — the same
 * class of invisible carrier failure that `raw_json=1` exists to prevent, from
 * the other end.
 *
 * The repair is to give the last unit back rather than to "clean" the string:
 * `toWellFormed()` would also rewrite lone surrogates the VENDOR sent, and this
 * file does not get to edit a stranger's text. We only undo the damage we did.
 * A grapheme cluster split across the bound is fine and deliberately not
 * handled — every code point that survives is still a whole one, and where a
 * skin-tone modifier or a ZWJ sequence ends is a rendering question, not a
 * correctness one.
 */
function bounded(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(max - 1);
  // A high surrogate in the final position has lost its partner to the slice.
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, max - 1) : cut;
}

/**
 * Title plus body, bounded. The title always survives — it is the part a human
 * would quote and the vendor caps it at 300 characters — and the bound eats
 * into the body from the end.
 */
function textOf(r: Rec): string {
  const title = str(r.title) ?? '';
  const body = bodyOf(r);
  return bounded(body === null ? title : `${title}\n\n${body}`, MAX_TEXT_CHARS);
}

/* ── media ────────────────────────────────────────────────────────────── */

/**
 * Only what the listing actually gives.
 *
 * The preview object is the one reliable source of a still: it carries a URL
 * and real pixel dimensions. `thumbnail` is included only when it is a URL at
 * all — this vendor puts the literal strings `self`, `default`, `nsfw`,
 * `spoiler` and `image` in that field, and any of them treated as a URI would
 * become a media reference pointing at nothing, which the media pipeline would
 * then try to fetch and hash.
 *
 * ★ NO PERCEPTUAL HASH IS EMITTED HERE, and that is not an omission. Hashing
 * needs the bytes, the bytes need a download, and a download is a second call
 * this file is not allowed to make. A placeholder hash would silently poison
 * the free carrier join, which is the grouper's whole basis. Absent is honest;
 * invented is not.
 */
function media(r: Rec): readonly MediaRef[] {
  const out: MediaRef[] = [];
  const seen = new Set<string>();

  const push = (ref: MediaRef): void => {
    if (out.length >= MAX_MEDIA) return;
    if (ref.uri.length === 0 || ref.uri.length > MAX_URI_CHARS) return;
    if (!/^https?:\/\//i.test(ref.uri)) return;
    if (seen.has(ref.uri)) return;
    seen.add(ref.uri);
    out.push(ref);
  };

  const video = rec(rec(r.media).reddit_video);
  const fallback = str(video.fallback_url);
  if (fallback !== null) {
    const seconds = num(video.duration);
    push({
      kind: 'video',
      uri: fallback,
      width: num(video.width),
      height: num(video.height),
      // Seconds here, milliseconds in our vocabulary. A 1000x error in a
      // duration is the same class of mistake as one in a timestamp.
      durationMs: seconds === null ? null : Math.round(seconds * 1000),
    });
  }

  for (const image of arr(rec(r.preview).images)) {
    const source = rec(rec(image).source);
    const uri = str(source.url);
    if (uri === null) continue;
    push({ kind: 'image', uri, width: num(source.width), height: num(source.height), durationMs: null });
  }

  const thumbnail = str(r.thumbnail);
  if (thumbnail !== null) push({ kind: 'image', uri: thumbnail, width: num(r.thumbnail_width), height: num(r.thumbnail_height), durationMs: null });

  return out;
}

/* ── carriers ─────────────────────────────────────────────────────────── */

/**
 * What can be produced HONESTLY from one listing payload: text shingles, and
 * nothing else.
 *
 * ★ NO ENTITY SPANS, AND THIS IS A DECISION RATHER THAN AN OVERSIGHT. The other
 * adapters read spans off an entity list the vendor computed — this vendor
 * publishes none. The tempting substitute is to run our own extractor over the
 * text, and that is precisely the drift the shared shingle width exists to
 * prevent: two sources extracting spans by two slightly different rules can
 * never produce a matching key, so the free cross-source join silently never
 * fires, and nothing fails. If we want spans from raw text, the extractor goes
 * in the shared kit next to `shingles`, used identically by every source. It
 * does not get invented here.
 *
 * The other tempting substitute is the post's flair, which is a short label the
 * community assigns. It is rejected for a different reason: it is a CATEGORY,
 * not a named thing. "Discussion" as an entity span would join every discussion
 * post on the platform to every other one — an almost-empty carrier key, which
 * the conformance suite bans in its degenerate form for exactly this reason.
 *
 * The shingle list is DEDUPLICATED, in first-seen order. Repetitive text
 * genuinely repeats a five-gram, the suite forbids a duplicate `kind|key` pair
 * on one item, and preserving the order keeps the translation deterministic —
 * which the suite also checks.
 */
function fingerprints(text: string): readonly Fingerprint[] {
  const out: Fingerprint[] = [];
  const seen = new Set<string>();
  for (const key of shingles(text)) {
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: 'textShingle', key, bits: 64 });
  }
  return out;
}

/* ── the translation ──────────────────────────────────────────────────── */

/**
 * @param raw one post payload, already unwrapped from its listing envelope
 * @param at  the instant WE read it, INJECTED. This file never calls a clock:
 *            every item in one response must share one observedAt, and a
 *            recorded fixture must replay to a byte-identical Item.
 */
export function toItem(raw: unknown, at: Millis): Item {
  const r = rec(raw);
  const fullname = fullnameOf(r);
  if (fullname === null) throw new TypeError('to-item: payload has no item id');

  const text = textOf(r);
  const community = communityOf(r);
  const id = itemId(SOURCE, fullname);

  /**
   * ★ A CROSSPOST IS A REPRODUCTION, NOT A REBROADCAST, AND GETTING THIS ROUND
   * THE WRONG WAY INVERTS THE SIGNAL THE PRODUCT IS BUILT ON. It creates a NEW
   * post, with a NEW author, that names the original — one new authorship,
   * which is the definition of reproduction. There is no object on this source
   * that copies without authoring, so `rebroadcastOf` is null for every item
   * and that is a statement rather than a gap.
   *
   * The pointer is read even though the reproduction COUNT is declared absent;
   * a pointer and a count are independent, and the other adapter has exactly
   * the same asymmetry. A parent naming itself is dropped rather than emitted:
   * the suite forbids a lineage field pointing at its own item, and a
   * self-referential cycle in the story graph is not a thing to discover later.
   *
   * ★ AND IT IS SHAPE-CHECKED FOR THE SAME REASON `fullnameOf` IS. This is an
   * id we did not mint, arriving from a stranger's payload, and it becomes an
   * `ItemId` — a value the rest of the system treats as ours. An unparseable
   * parent yields NULL rather than a pointer we know is wrong: the honest
   * reading of "this names a parent we cannot address" is that we have no
   * lineage for it, and a lineage edge into an item that cannot exist is a
   * fabricated relationship in the one graph the product's thesis rests on.
   */
  const parent = str(r.crosspost_parent);
  const reproductionOf =
    parent === null || !isFullname(parent) || parent === fullname ? null : itemId(SOURCE, parent);

  return {
    itemId: id,
    source: SOURCE,
    sourceItemId: fullname,
    authorKey: authorKey(SOURCE, stableAuthorId(r)),

    // Unix SECONDS on this source, milliseconds in our vocabulary. Null rather
    // than a guess: postedAt feeds the pre-mint ordering gate, and a
    // confidently wrong timestamp there silently inverts the gate's meaning.
    // `created_utc` and not `created`: the latter is in the vendor's local
    // time and has been the source of a whole genre of off-by-hours bugs.
    postedAt: secondsToMillis(r.created_utc),
    firstSeenAt: at,

    // ★ This source reports NO LANGUAGE on a post, under any spelling. Null is
    // the honest answer and a detector's guess is not: it would be our
    // inference wearing the source's authority, in a field every other adapter
    // fills from the vendor.
    lang: null,

    text,
    media: media(r),
    counters: toCounters(r, at),
    fingerprints: fingerprints(text),

    rebroadcastOf: null,
    reproductionOf,

    // No reusable template object exists here — no shared sound, no effect, no
    // layout id. An empty list is the truthful answer, and it must NOT become
    // the place the community is smuggled: see `rawRefFor` above.
    formatIds: [],

    rawRef: rawRefFor(community, fullname),
  };
}
