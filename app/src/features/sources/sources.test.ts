/**
 * THE SOURCE INDICATOR, tested against the rules it exists to hold.
 *
 * There is no DOM in this runner, which is exactly why every decision lives in sources.ts
 * and this file can reach all of it. Two of these tests are greps — one over the component
 * and one over the stylesheet — and both are here because the specific way this feature can
 * ship and do nothing is silent: a view computed, tested, and never rendered, or three
 * states drawn as one dot in three colours.
 *
 * THE FIVE RULES:
 *
 *   1. ★ THE THREE STATES ARE DISTINGUISHABLE WITHOUT COLOUR. Asserted twice — once on the
 *      shape mapping, which is the decision, and once on the stylesheet, which is where the
 *      decision could quietly stop being true.
 *
 *   2. ★ DORMANT NEVER RAISES AN ALARM ON ITS OWN. Nobody has failed when a source is off.
 *
 *   3. ★ WHEN NOTHING IS LIVE, THE SHELL SAYS WHY. "Nothing is ingesting" and "nothing is
 *      happening" produce the same empty board and this is the sentence between them.
 *
 *   4. ★ A HOSTILE OR OVER-LONG LABEL IS BOUNDED AND IS ONLY EVER TEXT.
 *
 *   5. ★ THE INDICATOR NEVER CLAIMS MORE THAN OUR OWN POLL SUPPORTS.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SourceFeed, SourceHealth, SourceState } from '../../shared/api/index.ts';
import { ReadError } from '../../shared/api/index.ts';
import { SHAPE_OF, sourceNotice, sourcePips, sourcesView } from './sources.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const T0 = 1_755_079_200_000;
const MIN = 60_000;
const HOUR = 60 * MIN;

function health(over: Partial<SourceHealth> = {}): SourceHealth {
  return {
    sourceId: 'reddit',
    label: 'Reddit',
    state: 'live',
    lastHeardAt: { known: true, at: T0 - MIN },
    ...over,
  };
}

function feed(sources: readonly SourceHealth[]): SourceFeed {
  return { tick: 1, sources };
}

/** A current, successful read. The baseline every branch below departs from. */
function current(sources: readonly SourceHealth[]) {
  return { feed: feed(sources), failure: null, lastOkAt: T0 - 1_000, now: T0 };
}

/* ── rule 1: three states, three shapes, legible in greyscale ─────────── */

test('★ each state renders distinguishably — three states, three distinct shapes', () => {
  /* The decision itself. If two states ever map to one shape, the indicator is a colour code
     and it has silently stopped working for the reader who cannot use colour. */
  const shapes = (['live', 'dormant', 'failing'] as const).map((s) => SHAPE_OF[s]);
  assert.equal(new Set(shapes).size, 3, 'two states share a shape');
});

test('★ greyscale: no state is distinguished by colour alone, in the stylesheet', () => {
  /* THE ASSERTION THAT STOPS THE OBVIOUS REFACTOR. Three dots in three colours is smaller,
     tidier CSS and it fails for roughly one man in twelve, and for everybody looking at a
     screenshot in a document. So the three classes are read as text, every declaration whose
     property is a COLOUR is discarded, and what is left — the geometry — has to differ.

     A grep is a poor tool and it is the only one available without a browser, so it is
     aimed at the exact thing that matters: that removing every colour from this stylesheet
     still leaves three different shapes. */
  const css = readFileSync(join(HERE, 'sources.module.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ' ',
  );

  /* Properties that carry only hue. Everything else is geometry or motion. `border` is NOT
     here: it is what makes the ring hollow, and hollow survives greyscale. */
  const COLOUR_ONLY = new Set(['background', 'background-color', 'color', 'box-shadow', 'border-color']);

  const geometryOf = (name: string): string => {
    const block = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(block?.[1] !== undefined, `.${name} is not in the stylesheet`);
    return (block[1] ?? '')
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d !== '')
      .filter((d) => !COLOUR_ONLY.has((d.split(':')[0] ?? '').trim()))
      .map((d) => d.replace(/\s+/g, ' '))
      .sort()
      .join('|');
  };

  const geometries = ['disc', 'ring', 'diamond'].map(geometryOf);
  for (const [i, g] of geometries.entries()) {
    assert.notEqual(g, '', `the ${['disc', 'ring', 'diamond'][i]} has no non-colour property`);
  }
  assert.equal(
    new Set(geometries).size,
    3,
    'two state classes are identical once the colour is removed — they differ by hue alone',
  );
});

test('the shape names the decision produces are the class names the stylesheet draws', () => {
  /* The two halves are joined by a string, so a rename on one side is silent. This is the
     join, asserted. */
  const css = readFileSync(join(HERE, 'sources.module.css'), 'utf8');
  for (const shape of Object.values(SHAPE_OF)) {
    assert.match(css, new RegExp(`\\.${shape}\\s*\\{`), `no .${shape} rule to render`);
  }
});

/* ── rule 2 and 3: when a sentence is owed, and when silence is ───────── */

test('★ dormant sources alone raise NO banner — nobody has failed', () => {
  /* The hardest line in the feature to hold. A source nobody turned on is a decision, and a
     banner over somebody's own decision is a banner they learn to look past — which costs us
     the day it says something they needed. */
  const pips = sourcePips([health({ state: 'dormant' }), health({ sourceId: 'x', label: 'X' })], T0);
  assert.equal(sourceNotice(pips), null, 'one live source and one deliberately-off source is fine');
});

test('★ when NO source is live, the board is told why — and the two whys differ', () => {
  /* The rule this whole build exists for. An empty board with everything switched off and an
     empty board with everything broken are the same picture, and they are not the same
     problem: one is a person deciding to pay for something, the other is a person being
     woken up. */
  const allOff = sourceNotice(
    sourcePips(
      [health({ state: 'dormant' }), health({ sourceId: 'x', label: 'X', state: 'dormant' })],
      T0,
    ),
  );
  const allBroken = sourceNotice(
    sourcePips(
      [health({ state: 'dormant' }), health({ sourceId: 'x', label: 'X', state: 'failing' })],
      T0,
    ),
  );

  assert.ok(allOff !== null && allBroken !== null, 'both states owe the reader a sentence');
  assert.notEqual(allOff.headline, allBroken.headline, 'off and broken must not read alike');
  assert.match(allOff.headline, /ingesting/);
  assert.match(allBroken.headline, /answering/);
});

test('★ NO sources at all says nothing is ingesting, not that nothing is happening', () => {
  /* The state on a machine where the pipeline exists and nobody has turned any of it on —
     which is the state this repository is in today. The board still renders rows; the
     sentence is what stops them being read as a picture of the present. */
  const notice = sourceNotice(sourcePips([], T0));
  assert.ok(notice !== null, 'an empty source list is the loudest fact this surface has');
  assert.match(notice.headline, /Nothing is ingesting/);
  assert.match(notice.detail, /not a quiet market/);
});

test('a failing source beside a live one names itself and says what is missing', () => {
  /* The board is not lying about the world here, it is missing a slice of it, and the size of
     that slice is invisible from the rows. Naming the source is allowed — the label is a
     display string the server chose — and it is the difference between a sentence somebody
     can act on and one they cannot. */
  const notice = sourceNotice(
    sourcePips(
      [health(), health({ sourceId: 'tiktok', label: 'TikTok', state: 'failing' })],
      T0,
    ),
  );
  assert.ok(notice !== null);
  assert.match(notice.headline, /TikTok is not answering/);
});

test('two failing sources are named as two, and the sentence under them agrees', () => {
  /* Found by running the five configurations against the live database: with X and TikTok
     both dark the headline correctly said "X and TikTok are not answering" and the line
     under it said "Posts from IT are missing", which sends the reader back up to work out
     which one was meant. The banner is read once, in a hurry, while something is broken. */
  const notice = sourceNotice(
    sourcePips(
      [
        health(),
        health({ sourceId: 'x', label: 'X', state: 'failing' }),
        health({ sourceId: 'tiktok', label: 'TikTok', state: 'failing' }),
      ],
      T0,
    ),
  );
  assert.ok(notice !== null);
  assert.match(notice.headline, /X and TikTok are not answering/);
  assert.match(notice.detail, /Posts from them are missing/);
});

test('every source live means no banner at all', () => {
  assert.equal(sourceNotice(sourcePips([health(), health({ sourceId: 'x', label: 'X' })], T0)), null);
});

/* ── rule 4: a label is somebody else's string ────────────────────────── */

test('★ an over-long label is bounded, and is bounded on CHARACTERS', () => {
  /* This element sits in a 58px nav on every route, immediately left of the only button in
     it. An unbounded label does not merely look wrong — it pushes the rest of the nav off the
     right of the screen. The server bounds it too; this is the second door, and a single door
     is not a door you rely on alone. */
  const pips = sourcePips([health({ label: 'Very Long Platform Name Indeed'.repeat(20) })], T0);
  assert.equal(Array.from(pips[0]?.label ?? '').length, 13, 'twelve characters and the ellipsis');
  assert.match(pips[0]?.label ?? '', /…$/, 'the truncation is visible, never silent');
});

test('an astral label is cut between characters, never through one', () => {
  const pips = sourcePips([health({ label: '🙂'.repeat(40) })], T0);
  const label = pips[0]?.label ?? '';
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(label), false, 'no lone surrogate');
});

test('a label that is only whitespace drops the source rather than drawing a nameless shape', () => {
  /* A coloured shape with no word beside it is not something a reader can act on, and
     inventing a word for it would be inventing a fact. Both doors fail in the same
     direction. */
  assert.deepEqual(sourcePips([health({ label: '   ' })], T0), []);
});

test('★ a hostile label reaches the component as TEXT and as nothing else', () => {
  /* A grep is a poor tool and it is the only one available without a DOM, so it is aimed at
     the exact constructs that would turn a string into something the browser executes or
     fetches. The decoder already refuses a label carrying a forbidden word and the projection
     already bounded and stripped it; this is the last door. */
  const pips = sourcePips([health({ label: '<img src=x onerror=alert(1)>' })], T0);
  assert.equal(typeof pips[0]?.label, 'string', 'a label is a string, never markup');
  assert.equal(COMPONENT.includes('dangerouslySetInnerHTML'), false);
  assert.equal(/\bhref\s*=/.test(COMPONENT), false, 'no anchor, so no URL built from a label');
  assert.equal(/\bsrc\s*=/.test(COMPONENT), false, 'no <img>, so no request to a chosen host');
  assert.equal(/\binnerHTML\b/.test(COMPONENT), false);
});

/* ── rule 5: never claim more than our own poll supports ──────────────── */

test('before the first read there are no pips, a dash, and NO banner', () => {
  /* We hold no statement about the pipeline yet, and inventing one before the first response
     lands is the same class of thing as a skeleton row. The dash is what stops the empty
     cluster reading as a healthy pipeline with nothing in it. */
  const view = sourcesView({ feed: null, failure: null, lastOkAt: null, now: T0 });
  assert.deepEqual(view.pips, []);
  assert.equal(view.notice, null);
  assert.equal(view.note?.text, '—');
  assert.equal(view.confirmed, false);
});

test('a failed read with no frame is a dash with a cause, and still no banner', () => {
  /* We know nothing about any source, so "nothing is ingesting" is a claim we have no
     evidence for. The 404 gets its own sentence because it is not a fault: it means nothing
     has recorded this yet, which is true and actionable and different from "we asked and got
     no answer". */
  const missing = sourcesView({
    feed: null,
    failure: new ReadError('/sources/default', 404),
    lastOkAt: null,
    now: T0,
  });
  const broken = sourcesView({
    feed: null,
    failure: new ReadError('/sources/default', 500),
    lastOkAt: null,
    now: T0,
  });

  assert.equal(missing.notice, null);
  assert.equal(missing.note?.text, '—');
  assert.notEqual(missing.note?.detail, broken.note?.detail, 'never-projected is not a fault');
});

test('★ a stale read keeps the states, stops claiming them, and says so', () => {
  /* The rail's grammar: "say what it is", never "show less". Blanking the pips would throw
     away true information because a later request failed. What goes is the CLAIM — `confirmed`
     is false, so the component stops the motion — and the note beside them says how old they
     are. */
  const view = sourcesView({
    feed: feed([health()]),
    failure: null,
    lastOkAt: T0 - 10 * MIN,
    now: T0,
  });
  assert.equal(view.pips.length, 1, 'the states we last read are still shown');
  assert.equal(view.pips[0]?.state, 'live');
  assert.equal(view.confirmed, false, 'but nothing pulses over a fact we could not refresh');
  assert.equal(view.note?.text, 'not updating');
});

test('★ the banner survives a stale read, because a fault does not stop being a fault', () => {
  /* Suppressing the sentence on a slow network would hide the fault at exactly the moment
     there is most reason to suspect one. The note beside the pips is what tells the reader
     how fresh the claim is; the banner still tells them what the claim was. */
  const view = sourcesView({
    feed: feed([health({ state: 'failing' })]),
    failure: new ReadError('/sources/default', 500),
    lastOkAt: T0 - MIN,
    now: T0,
  });
  assert.ok(view.notice !== null, 'the fault is still reported');
  assert.equal(view.confirmed, false);
});

test('a current read confirms, and says nothing about itself', () => {
  const view = sourcesView(current([health()]));
  assert.equal(view.confirmed, true);
  assert.equal(view.note, null, 'a healthy check does not narrate itself');
  assert.equal(view.notice, null);
});

/* ── the detail behind each shape ─────────────────────────────────────── */

test('★ "has never answered" and "answered three hours ago" are different sentences', () => {
  /* On both the dormant and the failing branch. Collapsing them loses the only thing that
     points at WHICH problem it is: a credential that never worked, or one that stopped. */
  const never = sourcePips(
    [health({ state: 'failing', lastHeardAt: { known: false, pending: 'not_read_yet' } })],
    T0,
  );
  const stopped = sourcePips(
    [health({ state: 'failing', lastHeardAt: { known: true, at: T0 - 3 * HOUR } })],
    T0,
  );
  assert.match(never[0]?.detail ?? '', /never answered/);
  assert.match(stopped[0]?.detail ?? '', /has not answered for/);
  assert.notEqual(never[0]?.detail, stopped[0]?.detail);
});

test('a dormant source is described as turned off, and never as failing', () => {
  const pips = sourcePips([health({ state: 'dormant' })], T0);
  assert.match(pips[0]?.detail ?? '', /not turned on/);
  assert.equal(/fail|error|broken/i.test(pips[0]?.detail ?? ''), false);
});

test('no sentence names a credential, a variable, a host or who we buy from', () => {
  /* The corollary of the vocabulary rule, and the sharp edge of this feature: the PLATFORM is
     what a user is told; whoever resells us their data is ours. So the dormant sentence may
     not say "no API key is configured", may not name an environment variable, and may not
     name a reseller — and the failing sentence says "not answering", never what the vendor
     actually returned. */
  const states: readonly SourceState[] = ['live', 'dormant', 'failing'];
  for (const state of states) {
    const detail = (sourcePips([health({ state })], T0)[0]?.detail ?? '').toLowerCase();
    for (const word of ['api', 'key', 'token', 'env', 'http', 'endpoint', 'apify', 'twitterapi']) {
      assert.equal(detail.includes(word), false, `the ${state} sentence names "${word}"`);
    }
  }
});

/* ── the component actually renders it ────────────────────────────────── */

/**
 * The component as text, with comments stripped.
 *
 * Stripping them is not cosmetic: the comments here explain at length that a label must never
 * become an href, so a grep that cannot tell an explanation from an instruction fails on the
 * very prose documenting the rule. `launches.test.ts` and `store/src/migrations.test.ts` both
 * strip for the same reason.
 */
const COMPONENT = readFileSync(join(HERE, 'SourceStatus.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ');

test('★ the component renders the shape, the label, the note AND the banner', () => {
  /* The specific way this whole change could ship and do nothing: a view computed, tested,
     and invisible. Four fields, four assertions. */
  assert.ok(COMPONENT.includes('pip.shape'), 'the shape is not rendered — this is a colour code');
  assert.ok(COMPONENT.includes('pip.label'), 'the label is not rendered');
  assert.ok(COMPONENT.includes('view.note'), 'the not-updating line is not rendered');
  assert.ok(COMPONENT.includes('view.notice'), 'the banner is not rendered');
});

test('★ the detail is reachable by keyboard, not only by mouse', () => {
  /* A native `title` appears on hover and NEVER on focus, so a title alone puts the whole
     explanation behind a mouse. Three channels: a focus target, a `:focus-within` tooltip in
     the stylesheet, and an accessible name. */
  assert.ok(/tabIndex=\{0\}/.test(COMPONENT), 'nothing here is focusable');
  assert.ok(COMPONENT.includes('aria-label'), 'the sentence never reaches a screen reader');
  const css = readFileSync(join(HERE, 'sources.module.css'), 'utf8');
  assert.match(css, /:focus-within \.tip/, 'the detail does not appear on keyboard focus');
});

test('the cluster is a status and never an alert', () => {
  /* A dark source is a degradation a reader should notice, not an interruption that seizes
     their focus. Every banner in this app makes the same call. */
  assert.ok(COMPONENT.includes('role="status"'));
  assert.equal(COMPONENT.includes('role="alert"'), false);
});

test('the component makes no product judgement of its own', () => {
  /* Everything the indicator decides is in sources.ts, where these tests can reach it. A
     comparison appearing in the component would be a rule nothing above can assert. */
  assert.equal(/[<>]=?\s*\d/.test(COMPONENT), false);
});
