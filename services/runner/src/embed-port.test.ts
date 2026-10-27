/**
 * The embedding switch: the policy's space picks the port, the environment only makes it
 * reachable, and a mismatched or unconfigured pairing is dormant with a reason.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import { E5_POST_SPACE, POST_SPACE as SELF_POST, SPACE as SELF } from '@insidor/embed-selfhost';

import { embedPortFor } from './embed-port.ts';

/* The hosted model's spaces from before our own: still the space of older stored vectors, no longer computed. */
const HOSTED = 'multimodal-3.1024';
const HOSTED_POST = `${HOSTED}.post`;

const meter = {} as Meter;
const both = {
  selfEmbed: { state: 'configured', baseUrl: 'http://embed.internal:8790', secret: 's'.repeat(30) },
} as const;

test('★ the default policy (v172) runs on our own service, whatever else is configured', () => {
  const got = embedPortFor(both, DEFAULT_POLICY.group.image, meter);
  assert.equal(got.port?.space, DEFAULT_POLICY.group.image.space);
  assert.equal(got.port?.postSpace, DEFAULT_POLICY.group.image.postSpace);
  assert.ok(got.port?.id.includes('embed-service'));
});

test('★ the policy naming the hosted model\'s old spaces is dormant: no port computes them any more', () => {
  const got = embedPortFor(both, { space: HOSTED, postSpace: HOSTED_POST }, meter);
  assert.equal(got.port, null);
  assert.match(got.dormant ?? '', /no embedding port/);
});

test('★ the policy naming our own space switches to our own service', () => {
  const got = embedPortFor(both, { space: SELF, postSpace: SELF_POST }, meter);
  assert.equal(got.port?.space, SELF);
  assert.equal(got.port?.postSpace, SELF_POST);
  assert.ok(got.port?.id.includes('embed-service'));
});

test('★ the policy naming our second post space builds the port for it (the switch is one policy version)', () => {
  const got = embedPortFor(both, { space: SELF, postSpace: E5_POST_SPACE }, meter);
  assert.equal(got.port?.space, SELF);
  assert.equal(got.port?.postSpace, E5_POST_SPACE);
});

test('a space whose port is not configured is dormant, with the reason', () => {
  const got = embedPortFor({ ...both, selfEmbed: { state: 'dormant' } }, { space: SELF, postSpace: SELF_POST }, meter);
  assert.equal(got.port, null);
  assert.match(got.dormant ?? '', /EMBED_SERVICE_URL/);
});

test('★ a picture space and a post space of two different models is refused', () => {
  const got = embedPortFor(both, { space: SELF, postSpace: HOSTED_POST }, meter);
  assert.equal(got.port, null);
  assert.match(got.dormant ?? '', /no embedding port/);
});
