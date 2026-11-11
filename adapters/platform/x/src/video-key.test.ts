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

test('★ a GIF is keyed by its media key, the same for every post re-using it (the boxing cat, 2026-11-11)', () => {
  const a = [{ uri: 'https://pbs.twimg.com/tweet_video_thumb/HWtlBQLXYAA7vhn.jpg', kind: 'video', playUri: 'https://video.twimg.com/tweet_video/HWtlBQLXYAA7vhn.mp4' }];
  const b = [{ uri: 'https://pbs.twimg.com/tweet_video_thumb/HWtlBQLXYAA7vhn.jpg?name=small', kind: 'video' }];
  assert.equal(videoKeyOf(a), 'x-gif:HWtlBQLXYAA7vhn');
  assert.equal(videoKeyOf(a), videoKeyOf(b));
  assert.notEqual(videoKeyOf(a), videoKeyOf([{ uri: 'https://pbs.twimg.com/tweet_video_thumb/HWtKGOmWcAASIza.jpg', kind: 'video' }]));
});

test('a photo with a media key like a GIF\'s is still not a video', () => {
  assert.equal(videoKeyOf([{ uri: 'https://pbs.twimg.com/media/HWtlBQLXYAA7vhn.jpg', kind: 'image' }]), null);
  assert.equal(videoKeyOf([{ uri: 'https://pbs.twimg.com/tweet_video_thumb/HWtlBQLXYAA7vhn/other.jpg', kind: 'video' }]), null);
});
