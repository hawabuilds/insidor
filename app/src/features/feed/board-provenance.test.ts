/**
 * What the seeded-board notice says, and — the test that matters — when it says nothing.
 *
 * The wording is asserted here rather than through a renderer for the reason
 * `sources.test.ts` gives about `sourceNotice`: what a banner SAYS is the entire product
 * of a banner, and a sentence that can only be checked by mounting React is a sentence
 * nobody checks.
 *
 * ★ THE LOAD-BEARING CASES ARE THE TWO SILENT ONES AND THE ONE THAT REFUSES TO BE SILENT.
 * A board of real stories must produce nothing, or the banner becomes furniture people
 * stop reading. A frame that did NOT say must produce something, or a server that stops
 * sending the field silently re-certifies six invented stories as observations — which is
 * the exact bug this whole path was built to close.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { provenanceNotice } from './board-provenance.ts';

test('a board of observed stories says nothing at all', () => {
  assert.equal(provenanceNotice({ kind: 'observed' }), null);
});

test('no frame yet is not a claim about anything', () => {
  /* Null is "nothing has been applied", which happens during the first fetch of every page
     load. A banner there is a warning about a board that does not exist yet, and it is how
     people learn to ignore the one that matters. */
  assert.equal(provenanceNotice(null), null);
});

test('★ an entirely seeded board says so, and says what to do about it', () => {
  const notice = provenanceNotice({
    kind: 'seeded',
    seededStories: 6,
    totalStories: 6,
    connectSourceLabel: 'Reddit',
  });
  assert.ok(notice !== null, 'six invented stories must not render under a bare heading');
  assert.match(notice.headline, /seeded demonstration data/);
  assert.match(notice.detail, /All 6 stories/);
  assert.match(notice.detail, /db:seed/);
  /* The actionable half. A notice that says only "this is fake" leaves the reader with
     nowhere to go, and the whole point is that the free source is one registration away. */
  assert.match(notice.detail, /Reddit is free/);
  assert.match(notice.detail, /disappears by itself/);
});

test('a mixed board counts rather than generalising', () => {
  /* The first thing that happens when a real source is connected: some rows are discovered
     and the seeded ones are still there. "All 9 stories" would be false, and the reader
     would be told the real row they just watched arrive is invented. */
  const notice = provenanceNotice({
    kind: 'seeded',
    seededStories: 6,
    totalStories: 9,
    connectSourceLabel: 'Reddit',
  });
  assert.ok(notice !== null);
  assert.match(notice.detail, /6 of the 9 stories/);
});

test('one seeded story is described in the singular', () => {
  const notice = provenanceNotice({
    kind: 'seeded',
    seededStories: 1,
    totalStories: 1,
    connectSourceLabel: 'Reddit',
  });
  assert.ok(notice !== null);
  assert.match(notice.detail, /The one story on this board was written/);
});

test('★ a frame that did not state its provenance is announced, never assumed real', () => {
  /* The direction of this default is the entire safety property. `unstated` folding into
     silence would mean a server that stopped sending the field publishes seeded stories as
     observations, from the field added to stop precisely that. */
  const notice = provenanceNotice({ kind: 'unstated' });
  assert.ok(notice !== null, 'not knowing must be said out loud');
  assert.match(notice.headline, /provenance not stated/);
  assert.match(notice.detail, /unverified/);
});
