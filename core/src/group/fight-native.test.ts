/**
 * The meme-war rule by the country a post names (fight-native.ts), on the 23-24 Oct posts: the
 * French posts mocking the Japanese seed France–Japan, the Chinese and Turkish posts join the
 * China–Turkey war, an English post or a small one never counts, and Turkish "çini" is not China.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_POLICY as P } from '@insidor/contracts/policy.ts';

import { answerHoldsPair, canonicalCountry, countriesNamed, fightPairsOf, planFights, type FightPost } from './fight-native.ts';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const H = 3_600_000;
const post = (itemId: string, lang: string | null, text: string, reach: number | null, authorKey: string | null = `a:${itemId}`, hoursAgo = 3): FightPost => ({ itemId, lang, text, reach, authorKey, atMs: NOW - hoursAgo * H });

test('a post names another country in its own language', () => {
  assert.deepEqual(countriesNamed('fr', "Moi (algerien et musulman), vais bientôt m'installer au Japon", P), ['Japan']);
  assert.deepEqual(countriesNamed('fr', 'Le spermatozoïde d’un Japonais qui cherche l’ovule', P), ['Japan']);
  assert.deepEqual(countriesNamed('zh', '我们不吃土耳其人，请不要误会。', P), ['Turkey']);
  assert.deepEqual(countriesNamed('tr', 'Binlerce yıllık kadim Çin kültürü', P), ['China']);
  assert.deepEqual(countriesNamed('tr', "ÇİN'DE marullar", P), ['China']);
  assert.deepEqual(countriesNamed('ja', 'フランス人がまた何か言ってる', P), ['France']);
  assert.deepEqual(countriesNamed('ko', '일본은 왜', P), ['Japan']);
});

test('a whole word stays whole, and its own country is not a pair', () => {
  assert.deepEqual(countriesNamed('tr', 'çiçek almak için çini ve çinko', P), []);
  assert.deepEqual(countriesNamed('fr', 'La France est belle', P), []);
  assert.deepEqual(countriesNamed('ja', '日本中の観光地や神社仏閣も見習え', P), []);
});

test('a language with no home country, or none, has no pair', () => {
  assert.deepEqual(fightPairsOf({ lang: 'en', text: 'Turkey and China are at war over memes' }, P), []);
  assert.deepEqual(fightPairsOf({ lang: null, text: '土耳其' }, P), []);
  assert.deepEqual(fightPairsOf({ lang: 'fr', text: 'Les japonais quand il pleut' }, P), [['France', 'Japan']]);
});

test('the posts of a live war join it; the titler\'s other spelling is ours', () => {
  const plan = planFights({
    posts: [post('zh1', 'zh', '我们不吃土耳其人', 340_862), post('tr1', 'tr', 'kadim Çin kültürü', 776_905), post('small', 'zh', '所有土耳其人的母亲', 30_000), post('en1', 'en', 'Turkey vs China', 900_000)],
    narratives: [{ id: 'n-war', countries: ['China', 'Türkiye'], newestPostAtMs: NOW - 2 * H }],
    nowMs: NOW,
  }, P);
  assert.deepEqual([...(plan.joins.get('n-war') ?? [])].sort(), ['tr1', 'zh1']);
  assert.equal(plan.seeds.length, 0);
});

test('a war with no post inside the active week takes no posts', () => {
  const plan = planFights({ posts: [post('zh1', 'zh', '土耳其', 340_862)], narratives: [{ id: 'n-old', countries: ['China', 'Turkey'], newestPostAtMs: NOW - P.narrative.fight.activeMs - H }], nowMs: NOW }, P);
  assert.equal(plan.joins.size, 0);
});

test('three viral posts from three accounts in a day seed a new pair; two do not; an unread count is not viral', () => {
  const fr = [
    post('fr1', 'fr', "Les japonais quand tu leurs dit que végéta est algérien", 164_530, 'a1', 20),
    post('fr2', 'fr', 'Le japonais qui remercie son patron', 288_592, 'a2', 10),
    post('fr3', 'fr', 'Moi, vais bientôt m’installer au Japon', 127_991, 'a3', 5),
    post('fr4', 'fr', 'Les japonnais ils sont détraqués complet sur X', null, 'a4', 4),
  ];
  const plan = planFights({ posts: fr, narratives: [], nowMs: NOW }, P);
  assert.deepEqual(plan.seeds, [{ countries: ['France', 'Japan'], members: ['fr1', 'fr2', 'fr3'] }]);
  const two = planFights({ posts: fr.slice(0, 2), narratives: [], nowMs: NOW }, P);
  assert.equal(two.seeds.length, 0);
  const oneAccount = planFights({ posts: fr.slice(0, 3).map((x) => ({ ...x, authorKey: 'same' })), narratives: [], nowMs: NOW }, P);
  assert.equal(oneAccount.seeds.length, 0);
});

test('a seed is shown only when the titler names both countries', () => {
  assert.equal(answerHoldsPair(['France', 'Japan'], ['France', 'Japan'], P), true);
  assert.equal(answerHoldsPair(['Japan', 'France', 'Algeria'], ['France', 'Japan'], P), true);
  assert.equal(answerHoldsPair([], ['France', 'Japan'], P), false);
  assert.equal(answerHoldsPair(['France'], ['France', 'Japan'], P), false);
  assert.equal(canonicalCountry('korea', P), 'South Korea');
});
