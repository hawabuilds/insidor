/**
 * THE FIRST DOOR, ASSERTED — bounding strings a stranger typed, before they are a row.
 *
 * `stream.test.ts` covers this file through `toStreamMintEvent`, which is the right place
 * for "a hostile frame does not end the socket". These are the properties of the bounding
 * itself, and they are here because they are claims about STRINGS rather than about a
 * stream: they need no fake socket, no clock and no rig, and two of them are invariants
 * everything downstream now depends on being true.
 *
 * THE TWO INVARIANTS, both of which this file used to state in prose and break in code:
 *
 *   1. ★ WHAT COMES OUT IS ALWAYS WELL-FORMED UTF-16, so it is always encodable as UTF-8.
 *      A lone surrogate is not a cosmetic problem. `pg` encodes one as U+FFFD, so the coin
 *      is stored wearing a replacement glyph forever; and anything that JSON-encodes it
 *      into a `jsonb` column instead gets `invalid input syntax for type json` and loses
 *      the whole write. The final cap here always cut on code points and was never the
 *      problem — the RAW pre-cap, added so that NFC is not run on a megabyte an attacker
 *      chose the size of, cut on UTF-16 units. It looked harmless because it sits eight
 *      times further along than any survivor should, and it was not, because the two steps
 *      in between DELETE characters: a thousand zero-width spaces followed by emoji strip
 *      down to a dozen code points, the final cap never fires, and the lone surrogate the
 *      pre-cap left is returned.
 *
 *   2. ★ WHAT COMES OUT CANNOT WEAR ANOTHER COIN'S TICKER. Cc and Cf do not cover every
 *      character a browser draws as nothing; the Hangul and Khmer fillers are letters and
 *      marks by category and measure zero pixels when rendered, so `"BᅟONK"` and `"BONK"`
 *      were two different stored strings that a person cannot tell apart on a list.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { boundedText, httpsUri, mintAddress } from './hostile.ts';

const NAME_MAX = 128;
const SYMBOL_MAX = 32;

/* ── ★ invariant 1: never an ill-formed string ────────────────────────── */

test('★ a string of invisible characters followed by emoji comes back well-formed', () => {
  /* The exact shape that defeats the raw pre-cap: long enough to trip it (1021 UTF-16
     units is past 128 * 8), stripped short enough afterwards that the final cap never
     fires, and cut at an odd offset so the boundary falls inside a surrogate pair. */
  const raw = `${'​'.repeat(1_001)}${'\u{1F600}'.repeat(20)}`;
  const out = boundedText(raw, NAME_MAX);
  assert.notEqual(out, null);
  assert.equal(out?.isWellFormed(), true, 'a lone surrogate reached a database column');
  assert.equal(out, '\u{1F600}'.repeat(11));
});

test('★ the output is well-formed wherever the pre-cap boundary happens to fall', () => {
  /* One length is not a test: the bug only appears when the cut lands on the FIRST half of
     a pair, so half of any single choice of input passes against the broken code. Walking
     the offset one unit at a time crosses the boundary in both directions. */
  for (let lead = 0; lead <= 24; lead += 1) {
    const raw = `${'​'.repeat(SYMBOL_MAX * 8 - lead)}${'\u{1F680}'.repeat(40)}`;
    const out = boundedText(raw, SYMBOL_MAX);
    assert.equal(out?.isWellFormed() ?? true, true, `ill-formed with ${lead} units of lead`);
  }
});

test('a name far past the cap is cut on characters, so the last one is whole', () => {
  const out = boundedText('\u{1F680}'.repeat(500), NAME_MAX);
  assert.equal(out?.isWellFormed(), true);
  assert.equal([...(out ?? '')].length, NAME_MAX, 'the cap counts characters, not UTF-16 units');
});

/* ── ★ invariant 2: no lookalikes ─────────────────────────────────────── */

test('★ a zero-width character cannot make one ticker render as another', () => {
  /* Each of these measures zero pixels in the rail's font, which is the only property that
     matters — the general category does not agree with the rendering, and it is the
     rendering a person reads. U+200B is Cf and was always caught; the rest are Lo and Mn. */
  const real = boundedText('BONK', SYMBOL_MAX);
  assert.equal(real, 'BONK');
  for (const invisible of ['​', 'ᅟ', 'ᅠ', '឴', '឵', 'ㅤ', 'ﾠ', '️']) {
    const point = invisible.codePointAt(0)?.toString(16).toUpperCase();
    assert.equal(boundedText(`B${invisible}ONK`, SYMBOL_MAX), real, `U+${point} survived the strip`);
  }
});

test('a ticker made only of invisible characters is null, not a blank ticker', () => {
  /* null is the vocabulary's word for "we do not have this", and the rail draws the dashed
     placeholder tile for it. A string of fillers would instead take the solid tile and an
     empty label — "this coin has a ticker", shown as nothing. */
  assert.equal(boundedText('ᅟㅤﾠ', SYMBOL_MAX), null);
});

test('a right-to-left override cannot survive to reorder the text around it', () => {
  assert.equal(boundedText('SAFE‮kcatta', SYMBOL_MAX), 'SAFEkcatta');
});

/* ── what must NOT change, so the fixes above are not quietly destructive ─ */

test('an ordinary name is returned exactly as it was typed', () => {
  assert.equal(boundedText('Pepe the Frog', NAME_MAX), 'Pepe the Frog');
  assert.equal(boundedText('WIF', SYMBOL_MAX), 'WIF');
});

test('markup is kept verbatim, because it is a name and not a document', () => {
  /* Escaping here would store a string the coin was never minted with. The rail renders it
     as a text node; that is where the safety is, and this door must not invent a second
     encoding that a later reader would have to undo. */
  assert.equal(boundedText('<script>alert(1)</script>', NAME_MAX), '<script>alert(1)</script>');
});

test('a newline separates words rather than joining them', () => {
  assert.equal(boundedText('line one\nline two', NAME_MAX), 'line one line two');
});

test('an empty, blank or absent value is null and never an empty string', () => {
  for (const raw of ['', '   ', '​​', null, undefined, 42, {}]) {
    assert.equal(boundedText(raw, NAME_MAX), null, `${String(raw)} should be null`);
  }
});

/* ── the other two doors in this file ─────────────────────────────────── */

test('an address is base58 in the length window, or it is not an address', () => {
  const good = '4kLmNq7wR2vTbYxEuHgJcZaPsDi9fQnXvMmZbCyVdRt8';
  assert.equal(mintAddress(good), good);
  /* Both separators `assetKey` throws on are excluded by base58 already, which is the
     point: this is strictly stronger than the constructor's rule, so the constructor never
     gets the chance to end a drain over one crafted field. */
  assert.equal(mintAddress('a:b'), null);
  assert.equal(mintAddress('a|b'), null);
  assert.equal(mintAddress('0OIl'.repeat(11)), null, 'the four characters base58 omits');
  assert.equal(mintAddress('short'), null);
  assert.equal(mintAddress('A'.repeat(500)), null);
  assert.equal(mintAddress(null), null);
});

test('★ only https survives, so a stored string cannot become executable downstream', () => {
  assert.equal(httpsUri('javascript:alert(1)', 512), null);
  assert.equal(httpsUri('data:text/html;base64,PHN2Zz4=', 512), null);
  assert.equal(httpsUri('http://plain.example/x', 512), null);
  assert.equal(httpsUri('https://pump.fun@evil.example/', 512), null, 'credentials are a phish');
  assert.equal(httpsUri('https://ipfs.example/QmX', 512), 'https://ipfs.example/QmX');
});

test('a URI that survives is well-formed too, so declared_social can be written', () => {
  /* `declared_social` is a jsonb column in the same INSERT as the name, so an ill-formed
     URI would lose the whole mint rather than one field. `new URL` percent-encodes, which
     is what makes this true — it is asserted rather than assumed because it is the reason
     nothing else in this file has to defend that column. */
  const out = httpsUri(`https://a.example/${'\u{1F600}'.repeat(300)}`, 512);
  if (out !== null) assert.equal(out.isWellFormed(), true);
});
