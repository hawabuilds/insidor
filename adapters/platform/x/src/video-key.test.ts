import assert from 'node:assert/strict';
import { test } from 'node:test';

import { videoKeyOf } from './video-key.ts';

test('★ the upload id of a video post, the same for every post re-using it (the H2O monkey)', () => {
  const a = [{ uri: 'https://pbs.twimg.com/amplify_video_thumb/2112621826228576256/img/KegLElhBqUUB5yjC.jpg', kind: 'video' }];
  const b = [{ uri: 'https://pbs.twimg.com/amplify_video_thumb/2112621826228576256/img/Other.jpg', kind: 'video' }];
  assert.equal(videoKeyOf(a), 'x-video:2112621826228576256');
  assert.equal(videoKeyOf(a), videoKeyOf(b));
});

test('a picture, a profile image or no media has no video key', () => {
  assert.equal(videoKeyOf([{ uri: 'https://pbs.twimg.com/media/HVbJTyrWMAAlQLc.jpg', kind: 'image' }]), null);
  assert.equal(videoKeyOf([{ uri: 'https://pbs.twimg.com/profile_images/2113136810717249536/x_400x400.jpg' }]), null);
  assert.equal(videoKeyOf(null), null);
  assert.equal(videoKeyOf([]), null);
});
