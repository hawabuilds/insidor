/**
 * Which coin pictures may share a stored vector: only an address that names its content, only
 * live, only with the switch on — and a failed copy sends the picture to the vendor as before.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';

import { contentAddressed, reuseCoinPicture } from './picture-reuse.ts';

const V0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
const V1 = 'bafkreifj3qjkwcspodufgq7rzeynbhhdo3cuu5ryzgnwszrhlytc5kmcde';
const on: Policy = { ...DEFAULT_POLICY, group: { ...DEFAULT_POLICY.group, image: { ...DEFAULT_POLICY.group.image, reuseContentAddressed: true } } };

test('★ an address names its content only by a content id: in the path after /ipfs/, or as the first host label', () => {
  assert.equal(contentAddressed(`https://gateway.example/ipfs/${V1}`), true);
  assert.equal(contentAddressed(`https://gateway.example/ipfs/${V0}?img-width=400`), true);
  assert.equal(contentAddressed(`https://${V1}.ipfs.gateway.example/`), true);
  assert.equal(contentAddressed(`ipfs://${V1}`), true);
  /* the same-looking address on a mutable host is not content-named */
  assert.equal(contentAddressed('https://cdn.example/5LbFWTKoykbaVuwjSrYhJ5Z.webp'), false);
  assert.equal(contentAddressed('https://storage.example/object/public/coins/abc.png'), false);
  assert.equal(contentAddressed('https://gateway.example/ipfs/not-a-content-id'), false);
  assert.equal(contentAddressed('not a url'), false);
});

function deps(policy: Policy, mode: 'dry' | 'live', found: boolean | 'throws') {
  const asked: string[] = [];
  return {
    asked,
    d: {
      images: {
        copyFromSameAddress: async (kind: 'item' | 'asset', id: string, uri: string) => {
          asked.push(`${kind}|${id}|${uri}`);
          if (found === 'throws') throw new Error('connection reset');
          return found;
        },
      },
      mode,
      policy,
      now: () => 1_000 as Millis,
    },
  };
}

test('★ off by default: nothing is copied and every picture goes to the vendor as before', async () => {
  const { asked, d } = deps(DEFAULT_POLICY, 'live', true);
  assert.equal(DEFAULT_POLICY.group.image.reuseContentAddressed, false);
  assert.equal(await reuseCoinPicture(d, 'a1', `https://g.example/ipfs/${V1}`, 'space'), false);
  assert.deepEqual(asked, []);
});

test('on and live: a content-named picture held by another coin is copied; a mutable one is never looked up', async () => {
  const { asked, d } = deps(on, 'live', true);
  assert.equal(await reuseCoinPicture(d, 'a1', `https://g.example/ipfs/${V1}`, 'space'), true);
  assert.equal(await reuseCoinPicture(d, 'a2', 'https://cdn.example/x.webp', 'space'), false);
  assert.deepEqual(asked, [`asset|a1|https://g.example/ipfs/${V1}`]);
});

test('nothing held, a dry run, or a failed read: false, so the picture is embedded as before', async () => {
  assert.equal(await reuseCoinPicture(deps(on, 'live', false).d, 'a1', `https://g.example/ipfs/${V1}`, 'space'), false);
  const dry = deps(on, 'dry', true);
  assert.equal(await reuseCoinPicture(dry.d, 'a1', `https://g.example/ipfs/${V1}`, 'space'), false);
  assert.deepEqual(dry.asked, []);
  assert.equal(await reuseCoinPicture(deps(on, 'live', 'throws').d, 'a1', `https://g.example/ipfs/${V1}`, 'space'), false);
});
