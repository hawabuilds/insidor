import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { xPictureOf } from './routes.ts';

test('★ a picture the app sends is kept only when it is an X avatar', () => {
  assert.equal(xPictureOf('https://pbs.twimg.com/profile_images/1/a_normal.jpg'), 'https://pbs.twimg.com/profile_images/1/a_normal.jpg');
  assert.equal(xPictureOf('http://pbs.twimg.com/profile_images/1/a.jpg'), null, 'https only');
  assert.equal(xPictureOf('https://evil.example/profile_images/a.jpg'), null, 'X picture host only');
  assert.equal(xPictureOf('https://pbs.twimg.com.evil.example/profile_images/a.jpg'), null);
  assert.equal(xPictureOf('https://pbs.twimg.com/media/a.jpg'), null, 'an avatar, not any picture');
  assert.equal(xPictureOf(42), null);
  assert.equal(xPictureOf(undefined), null);
});
