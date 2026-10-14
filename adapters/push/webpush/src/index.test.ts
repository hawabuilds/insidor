/** Unconfigured sends nothing; a gone device says so; the payload is title, body and an in-app path. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { webPushSender } from './index.ts';

const target = { endpoint: 'https://push.example/abc', p256dh: 'p', auth: 'a' };
const msg = { title: 'FERRY is up 5x', body: 'Your position is worth $1.2K', url: '/#/portfolio' };

test('with no keys, nothing is sent and the sender says it is not configured', async () => {
  let called = 0;
  const s = webPushSender({ publicKey: null, privateKey: null, subject: 'mailto:a@b.c' }, (async () => { called += 1; }) as never);
  assert.equal(s.configured, false);
  assert.equal(s.publicKey, null);
  assert.equal(await s.send(target, msg, 60), 'failed');
  assert.equal(called, 0);
});

test('a sent push carries only title, body and an in-app path; 410 means the device is gone', async () => {
  const seen: string[] = [];
  const ok = webPushSender({ publicKey: 'PUB', privateKey: 'PRIV', subject: 'mailto:a@b.c' }, (async (_sub: unknown, payload: string) => { seen.push(payload); }) as never);
  assert.equal(await ok.send(target, { ...msg, url: 'https://evil.example' }, 60), 'sent');
  assert.deepEqual(JSON.parse(seen[0] ?? '{}'), { title: msg.title, body: msg.body, url: '/' }, 'an outside link is never pushed');
  const gone = webPushSender({ publicKey: 'PUB', privateKey: 'PRIV', subject: 'mailto:a@b.c' }, (async () => { throw Object.assign(new Error('x'), { statusCode: 410 }); }) as never);
  assert.equal(await gone.send(target, msg, 60), 'gone');
});

test('pictures go as https links and a tag rides along; anything else is dropped; a refusal is reported with its status', async () => {
  const seen: string[] = [];
  const reports: { ok: boolean; status: number; host: string }[] = [];
  const s = webPushSender({ publicKey: 'PUB', privateKey: 'PRIV', subject: 'mailto:a@b.c' }, (async (_sub: unknown, payload: string) => { seen.push(payload); return { statusCode: 201 }; }) as never, (r) => reports.push(r));
  await s.send(target, { ...msg, image: 'https://img.example/p.jpg', icon: 'http://insecure.example/i.png', tag: 'rising_post:x:1' }, 60);
  assert.deepEqual(JSON.parse(seen[0] ?? '{}'), { ...msg, image: 'https://img.example/p.jpg', tag: 'rising_post:x:1' });
  assert.deepEqual(reports[0], { ok: true, status: 201, host: 'push.example', reason: '', endpoint: target.endpoint });
  const refused = webPushSender({ publicKey: 'PUB', privateKey: 'PRIV', subject: 'mailto:a@b.c' }, (async () => { throw Object.assign(new Error('x'), { statusCode: 403, body: '{"reason":"BadJwtToken"}' }); }) as never, (r) => reports.push(r));
  assert.equal(await refused.send(target, msg, 60), 'failed');
  assert.deepEqual(reports[1], { ok: false, status: 403, host: 'push.example', reason: '{"reason":"BadJwtToken"}', endpoint: target.endpoint });
});
