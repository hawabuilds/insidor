/** The card picture's size rewrite (picture-size.ts): only the picture host's own paths, only once. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { cardPictureUrl } from './picture-size.ts';

test('a post picture is asked for at the card size', () => {
  assert.equal(cardPictureUrl('https://pbs.twimg.com/media/HUkz.jpg'), 'https://pbs.twimg.com/media/HUkz?format=jpg&name=360x360');
  assert.equal(
    cardPictureUrl('https://pbs.twimg.com/amplify_video_thumb/1/img/a_b.png'),
    'https://pbs.twimg.com/amplify_video_thumb/1/img/a_b?format=png&name=360x360',
  );
});

test('a link that names a size, another host, or no picture is left alone', () => {
  const sized = 'https://pbs.twimg.com/media/HUkz?format=jpg&name=small';
  assert.equal(cardPictureUrl(sized), sized);
  const cover = 'https://p16.example.com/cover.jpeg?x=1';
  assert.equal(cardPictureUrl(cover), cover);
  assert.equal(cardPictureUrl('not a link'), 'not a link');
});
