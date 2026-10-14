/** The TikTok player's decisions (tiktok-player.ts): which posts get it, its address, and what its messages mean. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { playerSays, playerUrl, tiktokVideoId } from './tiktok-player.ts';

const T = 'https://www.tiktok.com';

test('only a TikTok post id has a TikTok video id', () => {
  assert.equal(tiktokVideoId('tiktok:7696270351092944149'), '7696270351092944149');
  assert.equal(tiktokVideoId('x:2109995948407476369'), null);
  assert.equal(tiktokVideoId('tiktok:abc'), null);
});

test("★ the player never starts itself and is never told to be muted, so a tap on it plays with sound", () => {
  const url = playerUrl('7696270351092944149');
  assert.match(url, /^https:\/\/www\.tiktok\.com\/player\/v1\/7696270351092944149\?.*autoplay=0/);
  assert.doesNotMatch(url, /muted|autoplay=1/);
});

test("★ only the player's own messages count, and a playback error is a failure", () => {
  assert.equal(playerSays(T, '{"type":"onPlayerReady","x-tiktok-player":true}'), 'ready');
  assert.equal(playerSays(T, '{"type":"onPlayerError","value":{"errorCode":3001,"errorType":"PLAYBACK_ERROR"},"x-tiktok-player":true}'), 'failed');
  assert.equal(playerSays(T, '{"type":"onStateChange","value":1,"x-tiktok-player":true}'), 'playing');
  assert.equal(playerSays(T, '{"type":"onStateChange","value":3,"x-tiktok-player":true}'), 'alive', 'buffering is not playing');
  assert.equal(playerSays(T, '[tea-sdk]ready'), 'alive', "the page's own plain-text hello means the page is up");
  assert.equal(playerSays('https://evil.example', '{"type":"onPlayerReady","x-tiktok-player":true}'), null);
  assert.equal(playerSays(T, { type: 'onPlayerError' }), 'alive', 'without the player mark it is not the player');
});
