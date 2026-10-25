/**
 * The meme-war rule by the country a post names (fight-native.ts), on the 23-24 Oct posts: the
 * French posts mocking the Japanese seed France–Japan, the Chinese and Turkish posts join the
 * China–Turkey war, an English post or a small one never counts, and Turkish "çini" is not China.
 * This week's wars (policy.v175): Arabic home to two countries pairs only into a war holding both,
 * Japanese joins at its own bar, the France vs Japan phrases, and the wars the owner named.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_POLICY as P } from '@insidor/contracts/policy.ts';

import { answerHoldsPair, canonicalCountry, countriesIn, countriesNamed, fightPairsOf, homesOf, joinReachOf, namedWarKeys, phrasePairsOf, planFights, warWords, type FightPost } from './fight-native.ts';

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

test('★ Japanese names the French in katakana or kanji, inside a word or not; 仏 alone (news, Buddhism) is not France', () => {
  assert.deepEqual(countriesNamed('ja', '仏人ってほんと性格悪いよな', P), ['France']);
  assert.deepEqual(countriesNamed('ja', 'またフランス人が日本人をバカにしてる', P), ['France']);
  assert.deepEqual(countriesNamed('ja', '仏蘭西の連中', P), ['France']);
  assert.deepEqual(countriesNamed('ja', '【仏で55万人デモ 市庁舎ほぼ全焼】', P), []);
  assert.deepEqual(countriesNamed('ja', '今日は仏滅の日曜日です', P), []);
  assert.deepEqual(fightPairsOf({ lang: 'ja', text: '仏人の煽りに返すミーム' }, P), [['France', 'Japan']]);
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
  assert.deepEqual(plan.seeds, [{ countries: ['France', 'Japan'], members: ['fr1', 'fr2', 'fr3'], named: false }]);
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

const unit = (...xs: number[]): Float32Array => {
  const len = Math.hypot(...xs);
  return Float32Array.from(xs.map((x) => x / len));
};
const war = (startHoursAgo: number | null, vectors: readonly Float32Array[] = []) => ({ id: 'n-fj', countries: ['France', 'Japan'], newestPostAtMs: NOW - H, startAtMs: startHoursAgo === null ? null : NOW - startHoursAgo * H, vectors });

test('★ the catch-up: a post up to two days before the war\'s own first post joins as early, an older one (the riots) never', () => {
  const plan = planFights({
    posts: [
      post('vegeta', 'fr', 'Les japonais quand tu leurs dit que végéta est algérien', 164_530, 'a1', 50),
      post('riots', 'ja', 'フランス暴動で豚肉製品は掠奪されず', 76_895, 'a2', 24 * 5),
      post('inside', 'fr', 'Le japonais qui remercie son patron', 288_592, 'a3', 10),
    ],
    narratives: [war(26)],
    nowMs: NOW,
  }, P);
  assert.deepEqual(plan.joins.get('n-fj'), ['inside']);
  assert.deepEqual(plan.early.get('n-fj'), ['vegeta']);
  /* No start known: the two-day read only, as before the catch-up. */
  const unknown = planFights({ posts: [post('vegeta', 'fr', 'Les japonais', 164_530, 'a1', 50)], narratives: [war(null)], nowMs: NOW }, P);
  assert.equal(unknown.joins.size + unknown.early.size, 0);
});

test('★ an English post naming both sides joins only when alike to the war; the news naming both, or one with no vector, does not', () => {
  const plan = planFights({
    posts: [
      { ...post('beef', 'en', 'this french vs japanese beef on the timeline is the funniest thing', 155_511), vector: unit(1, 0.25) },
      { ...post('php', 'en', 'PHP bugs hit servers in France and Japan', 1_361_129), vector: unit(0.3, 1) },
      { ...post('novec', 'en', 'France vs Japan on the timeline', 149_035), vector: null },
      { ...post('one', 'en', 'Japanese tourists everywhere', 300_000), vector: unit(1, 0.2) },
    ],
    narratives: [war(20, [unit(1, 0.2)])],
    nowMs: NOW,
  }, P);
  assert.deepEqual(plan.joins.get('n-fj'), ['beef']);
});

test('★ a narrative wholly a war\'s folds into it; a small mixed one gives up only its viral war post; a big one nothing', () => {
  const own = { id: 'n-own', members: [post('solo', 'fr', 'Le japonais qui plante une graine', 78_872)] };
  const mixed = { id: 'n-mixed', members: [post('fr1', 'fr', 'Les touristes japonais', 316_567), post('cat', 'fr', 'Mon chat dort', 50_000)] };
  const big = { id: 'n-big', members: [post('fr2', 'fr', 'Les japonais', 200_000), ...['b1', 'b2', 'b3'].map((x) => post(x, 'fr', 'autre chose', 90_000))] };
  const plan = planFights({ posts: [], narratives: [war(20)], placed: [own, mixed, big], nowMs: NOW }, P);
  assert.deepEqual(plan.merges, [{ from: 'n-own', into: 'n-fj' }]);
  assert.deepEqual(plan.moves, [{ itemId: 'fr1', from: 'n-mixed', into: 'n-fj' }]);
});

test('★ a quote of a war post in the other side\'s language joins though it names no country; in the same language, in English, of a waiting seed, or under the bar, it does not', () => {
  const posts = new Map<string, string | null>([['vegeta-fr', 'fr'], ['beef-en', 'en']]);
  const fj = { ...war(20), posts };
  /* A text with no name and no phrase of the war: only the quote can place it. */
  const q = (itemId: string, lang: string, refersTo: readonly string[], reach = 4_946_842, hoursAgo = 30) => ({ ...post(itemId, lang, '最大の証拠がコチラ', reach, `a:${itemId}`, hoursAgo), refersTo });
  const plan = planFights({
    posts: [
      q('ja-answer', 'ja', ['vegeta-fr']),
      q('ja-of-en', 'ja', ['beef-en'], 90_000, 3),
      { ...q('fr-pile', 'fr', ['vegeta-fr'], 134_706, 3), text: 'Quand ils vont découvrir que Picolo est Malien' },
      { ...q('en-quote', 'en', ['vegeta-fr'], 267_536, 3), text: 'Nah man the French up like 50 rn' },
      q('ja-small', 'ja', ['vegeta-fr'], 3_000, 3),
      q('ja-other', 'ja', ['x:unrelated'], 500_000, 3),
    ],
    narratives: [fj],
    nowMs: NOW,
  }, P);
  assert.deepEqual(plan.early.get('n-fj'), ['ja-answer'], 'older than the war\'s own first post: early');
  assert.deepEqual(plan.joins.get('n-fj'), ['ja-of-en'], 'an English war post has no side: a Japanese quote of it answers');
  /* A seed still waiting for the titler is handed in with no posts: nothing joins it by a quote. */
  const seed = planFights({ posts: [q('ja-answer', 'ja', ['vegeta-fr'], 4_946_842, 3)], narratives: [war(20)], nowMs: NOW }, P);
  assert.equal(seed.joins.size + seed.early.size, 0);
  const off = planFights({ posts: [q('ja-answer', 'ja', ['vegeta-fr'], 4_946_842, 3)], narratives: [fj], nowMs: NOW }, { ...P, narrative: { ...P.narrative, fight: { ...P.narrative.fight, native: { ...P.narrative.fight.native, answersOn: false } } } });
  assert.equal(off.joins.size + off.early.size, 0);
});

test('the catch-up searches each war\'s own languages for the other side, and English for both', () => {
  const words = warWords([{ countries: ['France', 'Japan'] }], P);
  assert.ok(words.find((w) => w.lang === 'fr')?.words.includes('japonais'));
  assert.ok(words.find((w) => w.lang === 'ja')?.words.includes('フランス'));
  assert.ok(words.find((w) => w.lang === 'ja')?.words.includes('仏人'));
  assert.ok(words.find((w) => w.lang === 'en')?.words.includes('french'));
  assert.equal(words.find((w) => w.lang === 'zh'), undefined, 'Chinese is neither side');
  assert.deepEqual(countriesIn('en', 'the French vs Japanese beef', P), ['France', 'Japan']);
});


test('★ a language of several homes pairs each home with the country named, and joins only a war holding both', () => {
  assert.deepEqual(homesOf('ar', P), ['Saudi Arabia', 'Egypt']);
  assert.deepEqual(homesOf('fr', P), ['France'], 'a plain string is one home');
  assert.deepEqual(fightPairsOf({ lang: 'ar', text: 'جمهور الأرجنتين بعد المباراة' }, P), [['Argentina', 'Saudi Arabia'], ['Argentina', 'Egypt']]);
  assert.deepEqual(fightPairsOf({ lang: 'ar', text: 'المصريين في كل مكان' }, P), [['Egypt', 'Saudi Arabia']], 'Egypt from the Saudi home; never Egypt against itself');
  const wars = [
    { id: 'n-sa', countries: ['KSA', 'Argentina'], newestPostAtMs: NOW - H },
    { id: 'n-be', countries: ['Brasil', 'Egypt'], newestPostAtMs: NOW - H },
  ];
  const plan = planFights({
    posts: [
      post('ar-arg', 'ar', 'جمهور الأرجنتين بعد المباراة', 120_000),
      post('ar-br', 'ar', 'البرازيل', 90_000),
      post('ar-eg', 'ar', 'المصريين في كل مكان', 479_000),
      post('es-sa', 'es', 'Los saudíes no saben perder', 95_000),
    ],
    narratives: wars,
    nowMs: NOW,
  }, P);
  assert.deepEqual(plan.joins.get('n-sa'), ['ar-arg', 'es-sa']);
  assert.deepEqual(plan.joins.get('n-be'), ['ar-br']);
  assert.equal(plan.seeds.length, 0, 'no live Saudi Arabia–Egypt war, and Arabic seeds only a named pair');
});

test('★ Arabic seeds only a war the owner named, and that seed says so; a single-home language seeds as before', () => {
  assert.ok(namedWarKeys(P).has('Argentina|Saudi Arabia'));
  const eg = ['e1', 'e2', 'e3'].map((id, i) => post(id, 'ar', 'المصريين', 200_000, `a${i}`, 5 + i));
  assert.equal(planFights({ posts: eg, narratives: [], nowMs: NOW }, P).seeds.length, 0, 'Saudi Arabia–Egypt is not named: no war invented');
  const arg = ['s1', 's2', 's3'].map((id, i) => post(id, 'ar', 'الأرجنتين', 200_000, `a${i}`, 5 + i));
  assert.deepEqual(planFights({ posts: arg, narratives: [], nowMs: NOW }, P).seeds, [{ countries: ['Argentina', 'Saudi Arabia'], members: ['s3', 's2', 's1'], named: true }]);
  const pt = ['p1', 'p2', 'p3'].map((id, i) => post(id, 'pt', 'o egito não aguenta', 200_000, `a${i}`, 5 + i));
  assert.deepEqual(planFights({ posts: pt, narratives: [], nowMs: NOW }, P).seeds.map((x) => [x.countries, x.named]), [[['Brazil', 'Egypt'], true]]);
});

test('★ Japanese joins a war at its own bar of 5k views by a phrase, never by naming the country alone; French still needs 40k; a seed needs 40k whatever the language', () => {
  assert.equal(joinReachOf('ja', P), 5_000);
  assert.equal(joinReachOf('fr', P), P.narrative.fight.native.minReach);
  const plan = planFights({
    posts: [
      post('ja-8k-phrase', 'ja', 'フランス人がまた日本人を', 8_000),
      post('ja-4k-phrase', 'ja', 'フランス人がまた日本人を', 4_000),
      /* The GP de France results at 22k (2026-10-25): naming France alone is not the war under 40k. */
      post('ja-skating', 'ja', 'フィギュアスケートGPシリーズフランス 女子 中井亜美 219.74点', 22_000),
      post('ja-50k-name', 'ja', 'フランスの暴動', 50_000),
      post('fr-20k', 'fr', 'Les japonais', 20_000),
    ],
    narratives: [{ ...war(20), confirmed: true }],
    nowMs: NOW,
  }, P);
  assert.deepEqual([...(plan.joins.get('n-fj') ?? [])].sort(), ['ja-50k-name', 'ja-8k-phrase']);
  const seed = planFights({ posts: ['j1', 'j2', 'j3'].map((id, i) => post(id, 'ja', '中国の観光客', 8_000, `a${i}`)), narratives: [], nowMs: NOW }, P);
  assert.equal(seed.seeds.length, 0, 'Japanese news at 8k does not seed');
});

test('★ a war phrase: every word must be there; ベジータ alone is merchandise, ベジータ with アルジェリア is the war', () => {
  assert.deepEqual(phrasePairsOf({ lang: 'ja', text: 'ベジータのフィギュア予約開始' }, P), []);
  assert.deepEqual(phrasePairsOf({ lang: 'ja', text: 'ベジータがアルジェリア出身なわけない' }, P), [['France', 'Japan']]);
  assert.deepEqual(phrasePairsOf({ lang: 'ja', text: 'アルジェリア人って言われても' }, P), [['France', 'Japan']]);
  assert.deepEqual(phrasePairsOf({ lang: 'fr', text: 'アルジェリア人' }, P), [], 'only in the phrase\'s own language');
  const fj = { ...war(20), confirmed: true };
  const posts = [
    post('vegeta', 'ja', 'ベジータがアルジェリア出身なわけない', 30_000),
    post('merch', 'ja', 'ベジータのフィギュア予約開始', 300_000),
    post('small', 'ja', 'アルジェリア人って言われても', 3_000),
  ];
  assert.deepEqual(planFights({ posts, narratives: [fj], nowMs: NOW }, P).joins.get('n-fj'), ['vegeta']);
  const waiting = planFights({ posts, narratives: [{ ...fj, confirmed: false }], nowMs: NOW }, P);
  assert.equal(waiting.joins.size, 0, 'a seed still waiting for the titler takes no post by a phrase');
  const none = planFights({ posts: ['a', 'b', 'c'].map((id, i) => post(id, 'ja', 'アルジェリア人', 300_000, `a${i}`)), narratives: [], nowMs: NOW }, P);
  assert.equal(none.seeds.length, 0, 'a phrase never seeds');
  assert.ok(warWords([{ countries: ['France', 'Japan'] }], P).find((w) => w.lang === 'ja')?.words.includes('ベジータ'), 'the catch-up sifts a phrase by its first word');
});
