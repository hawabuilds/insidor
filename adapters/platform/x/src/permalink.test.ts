/**
 * The URL is asserted CHARACTER FOR CHARACTER, and that is the whole point of the
 * test. Everything else in this package can be checked by reading it; a link cannot
 * — a wrong path segment or a stray '@' still typechecks, still renders, still looks
 * like a citation, and only fails in a browser belonging to the one user who
 * bothered to check our work. So the expected string is written out in full rather
 * than rebuilt from the same template the implementation uses, which would assert
 * nothing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { postUrl } from './permalink.ts';

test('a handle and an id build the canonical post URL exactly', () => {
  assert.equal(postUrl('localferrywatch', '1'), 'https://x.com/localferrywatch/status/1');
  assert.equal(
    postUrl('harbourdaily', '1770000000000000002'),
    'https://x.com/harbourdaily/status/1770000000000000002',
  );
});

test('the canonical host is the destination, not the redirect', () => {
  /* twitter.com 301s here today. Citing the redirect would make every link we have
     ever published depend on a hop that is somebody else's to withdraw. */
  const url = postUrl('dockrefuser', '4');
  assert.equal(url.startsWith('https://x.com/'), true);
  assert.equal(url.includes('twitter.com'), false);
});
