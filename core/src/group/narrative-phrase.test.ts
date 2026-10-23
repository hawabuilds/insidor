/**
 * The same words in any script (narrative-phrase.ts): French with its accents, Japanese with no
 * spaces, and the function words that would otherwise count as rare among English posts.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY as P } from '@insidor/contracts/policy.ts';

import { cjkPieces, contentWords, phrasesOf, rarePhrases, storyWords } from './narrative-phrase.ts';

test('French: accents folded, function words out, links out', () => {
  assert.deepEqual(contentWords('Les japonais quand tu leurs dit que végéta est algérien https://t.co/x', P), ['japonais', 'vegeta', 'algerien']);
});

test('Japanese: katakana runs are words, hiragana only separates them', () => {
  assert.deepEqual(contentWords('ベジータがアルジェリア人ではない', P), ['ベジータ', 'アルジェリア']);
});

test('★ two posts saying "végéta est algérien" share a phrase; word order does not matter', () => {
  const a = phrasesOf(['les japonais ils sont au courant que végéta est algérien ?'], P);
  const b = phrasesOf(["l'algérien végéta"], P);
  assert.ok(a.has('algerien·vegeta'));
  assert.ok(b.has('algerien·vegeta'));
});

test('a phrase only one post says, or that many posts say, is not rare', () => {
  const sets = [new Set(['a·b']), new Set(['a·b']), new Set(['c·d']), ...Array.from({ length: 400 }, () => new Set(['e·f']))];
  const rare = rarePhrases(sets, P);
  assert.ok(rare.has('a·b'));
  assert.ok(!rare.has('c·d'));
  assert.ok(!rare.has('e·f'));
});

test('★ a han or katakana run in two-character pieces: 四ツ谷駅 and JR四ツ谷駅前 meet, 除草作業 and 除草目的 meet', () => {
  const a = cjkPieces(['四ツ谷駅にヤギが登場、除草作業']);
  const b = cjkPieces(['JR四ツ谷駅前のヤギ、除草目的 https://t.co/x @JREast']);
  for (const w of ['四ツ', 'ツ谷', '谷駅', 'ヤギ', '除草']) {
    assert.ok(a.has(w), w);
    assert.ok(b.has(w), w);
  }
  assert.ok(![...b].some((w) => /[A-Za-z]/.test(w)), 'Latin letters are not pieces');
  assert.ok(storyWords(['végéta est algérien'], P).has('algerien·vegeta'), 'the phrases are story words too');
});
