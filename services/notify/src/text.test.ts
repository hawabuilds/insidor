/** ★ No coin or post score ever reaches alert text: every kind is fed facts poisoned with scores, and none comes out. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { ALERT_KINDS } from '@insidor/core';

import { alertText } from './text.ts';

const POISON = { score: 0.97, confidence: 0.88, memeScore: 91, heat: 7.5, probability: 0.61, rank: 'goat', who: '@hawa', excerpt: 'nice call', symbol: 'FERRY', multiple: 5, positionUsd: 1234.5, percent: 92.4, source: 'X', author: '@nordkyst_ferge', views: 41_000, title: 'Ferry horn goes viral' };
const FORBIDDEN = [/0\.97/, /0\.88/, /\b91\b/, /7\.5/, /0\.61/, /score/i, /confidence/i, /probab/i, /heat/i, /pump/i, /moon/i, /will\b/i];

test('★ every alert kind reads only its own facts: no score, probability or prediction gets through', () => {
  for (const kind of ALERT_KINDS) {
    const { title, body } = alertText(kind, POISON);
    for (const bad of FORBIDDEN) assert.ok(!bad.test(`${title} ${body}`), `${kind}: "${title} / ${body}" matched ${bad}`);
  }
});

test('the facts read as facts', () => {
  assert.deepEqual(alertText('holding_multiple', POISON), { title: '$FERRY is up 5x since you bought', body: 'Your position is worth $1.2K' });
  assert.deepEqual(alertText('graduating_soon', POISON), { title: '$FERRY is close to graduating', body: '92% of the way through its curve' });
  assert.deepEqual(alertText('rising_post', POISON), { title: 'Rising on X', body: 'A post by @nordkyst_ferge: 41K views' });
  assert.deepEqual(alertText('rank_up', { rank: 'analyst' }), { title: 'You reached Analyst', body: 'Holders liked your calls.' });
  assert.deepEqual(alertText('rising_post', {}), { title: 'Rising on social', body: 'A post by someone is rising.' }, 'a missing fact is said plainly, never a zero');
});

test("a supplier warning names the role and the money, and says so plainly when a number is missing", () => {
  assert.deepEqual(alertText('supplier_warning', { role: 'judge', share: 0.8, spentUsd: 6.4, capUsd: 8 }), { title: 'Judge at 80% of its daily line', body: '$6.40 of $8.00 spent today (UTC).' });
  assert.deepEqual(alertText('supplier_warning', { role: 'short video', share: 0.95, spentUsd: 2.86, capUsd: 3 }), { title: 'Short video at 95% of its daily line', body: '$2.86 of $3.00 spent today (UTC).' });
  assert.deepEqual(alertText('supplier_warning', {}), { title: 'A supplier at a warning share of its daily line', body: 'Its spend today reached that share of the line.' });
});
