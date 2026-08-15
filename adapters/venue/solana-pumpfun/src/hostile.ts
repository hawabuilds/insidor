/**
 * Bounding attacker-typed metadata, at the last edge that can still refuse it.
 *
 * Every string on a mint event was typed by whoever made the coin. `str()` in
 * vendor-kit answers one question — "is this a non-empty string" — and
 * deliberately nothing else, because at that layer the only distinction that
 * pays is absent-versus-zero. This file answers the other question: is it a
 * string we are willing to STORE. Nothing downstream asks it. `public.asset.name`
 * and `symbol` are unbounded `text`, `image_uri` is unbounded `text`, and
 * `declared_social` is `jsonb` whose reader drops non-strings but bounds nothing.
 *
 * THREE THINGS GO WRONG, and all three are ordinary on a public mint feed.
 *
 *   LENGTH. A 10KB name is a 10KB row, a 10KB projected payload and a 10KB DOM
 *   node, once per render, for the life of the coin. Nothing between the socket
 *   and the browser has a cap of its own, so the cap has to be here.
 *
 *   INVISIBLE CHARACTERS. A right-to-left override (U+202E) inside a name
 *   reverses the rendering of everything after it, so the glyphs a user reads
 *   are not the characters we stored — which is the whole mechanism of a
 *   lookalike ticker. Zero-width joiners let two different byte strings render
 *   identically, which is how one coin impersonates another in a list of a
 *   hundred. Control characters break log lines and JSON readers. None of them
 *   survive this file.
 *
 *   SCHEME. A URI is kept only when it is `https:`. `javascript:` and `data:`
 *   are how a stored string becomes executable somewhere downstream, and the
 *   cheapest place to refuse them is before they are a row — a stored bad scheme
 *   has to be refused again by every reader, forever, and one of them will
 *   forget.
 *
 * NOTHING HERE THROWS. A value that fails any test becomes `null`, because one
 * hostile coin must not be able to end a page of a hundred honest ones, and
 * `null` is already the vocabulary's word for "we do not have this". Throwing
 * would turn a bad name into a lost page, and a lost page is a coverage gap we
 * caused ourselves.
 */

/**
 * Unicode general categories Cc (control) and Cf (format). Cf is the class that
 * matters: it holds the bidi overrides U+202A–U+202E and U+2066–U+2069 and the
 * zero-width joiners. The explicit second range is belt and braces — U+200B and
 * U+FEFF have moved category between Unicode revisions, and a check that depends
 * on which revision the runtime shipped is not a check.
 *
 * ★ AND `Default_Ignorable_Code_Point`, WITHOUT WHICH THE LOOKALIKE THIS FILE
 * NAMES IN ITS HEADER STILL GETS THROUGH. The two categories above do not cover
 * every character that draws as nothing: U+115F HANGUL CHOSEONG FILLER, U+1160
 * HANGUL JUNGSEONG FILLER and U+17B4 KHMER VOWEL INHERENT AQ are Lo and Mn —
 * letters and marks by category — and each measures zero pixels when rendered.
 * "BᅟONK" and "BONK" are then two different stored strings that a person
 * cannot tell apart on a list, which is exactly the "one coin impersonates
 * another" failure described above. The property is Unicode's own answer to "is
 * this drawn", so it does not need extending by hand the way a range does.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u200B-\u200F\u2060-\u206F\uFEFF]/gu;

/** Base58 as the chain spells it: no 0, no O, no I, no l. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * The address length window. Public keys are 32 bytes, which is 43–44 base58
 * characters, but leading zero bytes shorten the encoding, so the floor is
 * generous. Both ends are here because "looks like base58" is satisfied by a
 * single character and by a megabyte.
 */
const ADDRESS_MIN = 32;
const ADDRESS_MAX = 44;

/**
 * Normalise, strip what cannot be seen, collapse runs of whitespace, trim, and
 * cap by CODE POINT rather than by UTF-16 unit — slicing a string in the middle
 * of a surrogate pair produces a lone surrogate, which is not valid UTF-8 and
 * which Postgres rejects on insert. A hostile name would then fail the write for
 * the whole page rather than merely be long.
 *
 * NFC first, so two spellings of the same visible text do not survive as two
 * different stored values.
 *
 * ★ AND WHITESPACE BECOMES A SPACE BEFORE ANYTHING IS DELETED, WHICH IS THE ONE
 * STEP WHOSE ORDER MATTERS. A newline is a control character AND a word
 * separator, so a strip that runs first deletes it and turns "OFFICIAL\nUSDC"
 * into "OFFICIALUSDC" — a name that reads as one word is a different name, and
 * on this venue that is a free way to arrive at somebody else's spelling. The
 * projection makes exactly this argument on the same two lines; the two doors
 * now agree, so a name means the same thing whichever one you ask.
 */
export function boundedText(value: unknown, maxChars: number): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;

  /*
   * Cap the raw input before normalising. NFC on a multi-megabyte string is work
   * an attacker gets to choose the size of; the cap is generous enough that no
   * honest value is touched by it.
   *
   * ★ AND THIS SLICE IS THE ONE THAT HAS TO BE SURROGATE-SAFE, WHICH IS NOT
   * OBVIOUS, BECAUSE THE FINAL CAP BELOW ALREADY IS. `slice` counts UTF-16
   * units, so a cut at `maxChars * 8` can land between the halves of one astral
   * character and leave a lone high surrogate. It is tempting to think the cap
   * below removes it — it sits eight times further along than any survivor
   * should — but the two steps in between DELETE characters: a name of a
   * thousand zero-width spaces followed by emoji strips down to a dozen code
   * points, the final cap never fires, and the lone surrogate is returned. That
   * string is what the header promises this function never produces. It is not
   * representable in UTF-8, so `pg` encodes it as U+FFFD and the coin is stored
   * wearing a replacement glyph, and anything that JSON-encodes it into a
   * `jsonb` column instead gets `invalid input syntax for type json` and loses
   * the whole write. Dropping a trailing unpaired high surrogate costs one
   * character off a cap nothing honest reaches.
   */
  let raw = value;
  if (value.length > maxChars * 8) {
    raw = value.slice(0, maxChars * 8);
    const last = raw.charCodeAt(raw.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) raw = raw.slice(0, -1);
  }

  const cleaned = raw.normalize('NFC').replace(/\s/gu, ' ').replace(INVISIBLE, '').replace(/ {2,}/gu, ' ').trim();
  if (cleaned.length === 0) return null;

  const points = Array.from(cleaned);
  const capped = points.length > maxChars ? points.slice(0, maxChars).join('') : cleaned;
  return capped.length === 0 ? null : capped;
}

/**
 * An address we are willing to make an `AssetRef` out of.
 *
 * This exists because `assetKey()` THROWS on a component that is empty or that
 * contains ':' or '|', and it is called once per decoded event. A hostile
 * address would take down the whole drain rather than one row. Checking the
 * shape first turns that into a dropped row, which is what a bad row deserves.
 *
 * Base58 already excludes both separators, so this is strictly stronger than the
 * constructor's own rule and the constructor stays the thing that enforces it.
 */
export function mintAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < ADDRESS_MIN || trimmed.length > ADDRESS_MAX) return null;
  return BASE58.test(trimmed) ? trimmed : null;
}

/**
 * A URI we are willing to store, which means `https:` and nothing else.
 *
 * `new URL` is the parser, not a regular expression, because the interesting
 * attacks are all parser disagreements — `https:/\evil.example`, embedded
 * credentials, a scheme hidden behind whitespace — and hand-rolling a second
 * opinion about URL syntax is how the two disagree.
 *
 * Note what this does NOT do: it does not fetch, and it does not make the value
 * safe to render as a link. It makes it safe to keep.
 */
export function httpsUri(value: unknown, maxChars: number): string | null {
  const text = boundedText(value, maxChars);
  if (text === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  // Credentials in a URI are never something an honest issuer needs and are a
  // standard phishing shape (`https://pump.fun@evil.example/`).
  if (parsed.username !== '' || parsed.password !== '') return null;
  return parsed.href.length > maxChars ? null : parsed.href;
}
