/** The phone's reading of a coin's fomo theses: kept as sent, a half-made one dropped, a missing answer a reason. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeCoinTheses } from './theses.ts';

const one = { id: 't-1', at: 1_793_998_952_611, handle: 'tradera', name: 'Trader A', pictureUrl: 'https://p/a.jpg', text: 'we send higher', marketCapUsd: 1_498_670, likes: 1, position: { valueUsd: 1190.95, pnlUsd: -137.8, pnlPct: -10.4, closed: false }, url: 'https://fomo.family/tokens/solana/X' };

test('★ a thesis is kept as the server sent it; one without its words or an https link is dropped', () => {
  const out = decodeCoinTheses({ theses: [one, { ...one, id: 't-2', text: '' }, { ...one, id: 't-3', url: 'javascript:alert(1)' }, { ...one, id: 't-4', pictureUrl: 'http://p/a.jpg', position: null }] });
  assert.equal(out.kind, 'read');
  assert.deepEqual(out.kind === 'read' ? out.theses.map((t) => t.id) : [], ['t-1', 't-4']);
  assert.deepEqual(out.kind === 'read' ? out.theses[0] : null, one);
  assert.equal(out.kind === 'read' ? out.theses[1]?.pictureUrl : 'x', null, 'not https: no picture');
  assert.equal(out.kind === 'read' ? out.theses[1]?.position : 'x', null);
});

test('no theses read is a reason, never an empty list', () => {
  assert.deepEqual(decodeCoinTheses({ theses: null, why: 'login_expired' }), { kind: 'missing', why: 'login_expired' });
  assert.deepEqual(decodeCoinTheses({}), { kind: 'missing', why: 'unavailable' });
});
