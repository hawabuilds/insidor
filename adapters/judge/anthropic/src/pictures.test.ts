/**
 * The picture host's named sizes: which addresses are rewritten, and which are left alone.
 * Pure string work; no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { sizedPictureUri } from './pictures.ts';

test('a post picture and a video preview still are asked for at the named size, format kept', () => {
  assert.equal(sizedPictureUri('https://pbs.twimg.com/media/HUd3MNYXoAANXp_.jpg', 'small'), 'https://pbs.twimg.com/media/HUd3MNYXoAANXp_.jpg?format=jpg&name=small');
  assert.equal(
    sizedPictureUri('https://pbs.twimg.com/amplify_video_thumb/1/img/K.jpg', '360x360'),
    'https://pbs.twimg.com/amplify_video_thumb/1/img/K.jpg?format=jpg&name=360x360',
  );
  assert.equal(sizedPictureUri('https://pbs.twimg.com/media/X?format=png&name=large', 'small'), 'https://pbs.twimg.com/media/X?format=png&name=small');
});

test('another host, an address with no known format, or junk is left exactly as it was', () => {
  for (const uri of ['https://p16-sign.tiktokcdn.com/a.jpeg', 'https://pbs.twimg.com/media/X', 'not a url']) {
    assert.equal(sizedPictureUri(uri, 'small'), uri);
  }
});
