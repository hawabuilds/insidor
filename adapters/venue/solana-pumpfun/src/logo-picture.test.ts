/**
 * Where a coin's logo is fetched from: the gateway chain for a content-addressed picture, the
 * metadata document read from the next gateway when one fails, and the launchpad's copy (its
 * placeholder is no picture) — with a stand-in fetch, never the network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { IPFS_GATEWAYS, RESIZING_GATEWAYS, launchpadPicture, metadataPicture, pictureUrls } from './logo-picture.ts';

const CID = 'bafkreighm2xtaqmkgdgk5ysv5dc6tek6uvzjktv7f42ean7det7cr4qfde';

test('★ a content-addressed picture is tried on the host it was written on, then every gateway, resized first where it can be', () => {
  const each = (g: string) => [...(RESIZING_GATEWAYS.includes(g) ? [`${g}/ipfs/${CID}?img-width=256&img-height=256&img-format=webp`] : []), `${g}/ipfs/${CID}`];
  const u = pictureUrls(`https://own.gateway.example/ipfs/${CID}`);
  assert.equal(u[0], `https://own.gateway.example/ipfs/${CID}`);
  assert.deepEqual(u.slice(1), IPFS_GATEWAYS.flatMap(each));
  assert.deepEqual(pictureUrls(`ipfs://${CID}`), IPFS_GATEWAYS.flatMap(each));
  assert.ok(pictureUrls(`https://pump.mypinata.cloud/ipfs/${CID}`)[0]?.endsWith('img-format=webp'));
});

test('an https picture with no content id is itself; anything else is nothing', () => {
  assert.deepEqual(pictureUrls('https://cdn.example/p.webp'), ['https://cdn.example/p.webp']);
  assert.deepEqual(pictureUrls('http://cdn.example/p.webp'), []);
  assert.deepEqual(pictureUrls('data:image/png;base64,xx'), []);
  assert.deepEqual(pictureUrls(null), []);
});

const answer = (status: number, body: string) => new Response(body, { status, headers: { 'content-type': 'application/json' } });

test('★ a content-addressed document is read from the next gateway when one answers 429', async () => {
  const asked: string[] = [];
  const fetch = (async (url: string) => {
    asked.push(url);
    return url.startsWith('https://ipfs.io') ? answer(429, 'slow down') : answer(200, JSON.stringify({ image: `ipfs://${CID}` }));
  }) as typeof globalThis.fetch;
  const picture = await metadataPicture(`https://ipfs.io/ipfs/${CID}`, { fetch, timeoutMs: 1000, maxBytes: 10_000 });
  assert.equal(picture, `ipfs://${CID}`);
  assert.equal(asked.length, 2);
});

test('every gateway failing throws, so the mirror records a failure and not "no picture"', async () => {
  const fetch = (async () => answer(504, '')) as unknown as typeof globalThis.fetch;
  await assert.rejects(metadataPicture(`ipfs://${CID}`, { fetch, timeoutMs: 1000, maxBytes: 10_000 }));
});

test('the launchpad copy: where its image service sends us, null for its placeholder, a throw when it is down', async () => {
  const cfg = (status: number, location: string | null) => ({
    fetch: (async () => new Response(null, { status, headers: location === null ? {} : { location } })) as unknown as typeof globalThis.fetch,
    timeoutMs: 1000,
  });
  assert.equal(await launchpadPicture('M', cfg(302, 'https://img.example/coin-image/M/256x256')), 'https://img.example/coin-image/M/256x256');
  assert.equal(await launchpadPicture('M', cfg(302, 'https://images.example/coin-image/placeholder-mint?variant=256x256')), null);
  assert.equal(await launchpadPicture('M', cfg(404, null)), null);
  await assert.rejects(launchpadPicture('M', cfg(503, null)));
});
