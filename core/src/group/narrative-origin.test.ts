/**
 * The starting post and one story across languages (narrative-origin.ts), on the Chinese–Turkish
 * meme war of 19–23 Oct as it was stored: four English narratives, two origin posts four days older
 * in Turkish and Chinese, joined only by what the posts quote.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY as P, type Policy } from '@insidor/contracts/policy.ts';

import { foldNarrativeCalls, type NarrativePost } from './narrative.ts';
import { linkReach, standsOnViralPost, traceStories, type OriginInput } from './narrative-origin.ts';

const H = 3_600_000;
const DAY = 24 * H;
const T0 = 100 * DAY;
const post = (itemId: string, atMs: number, names: readonly string[] = []): NarrativePost => ({ itemId, atMs, text: `post ${itemId}`, names, hasPicture: false });
const unit = (angle: number) => Float32Array.from([Math.cos(angle), Math.sin(angle)]);

/* Turkey&China (tc1, tc2), Calajo (ca1, ca2), Lele (le1, le2); origins tr (Turkish) and zh (Chinese). */
function beef(over: Partial<OriginInput> = {}): OriginInput {
  const posts = [
    post('tr', T0 - 4 * DAY, ['CATHAT']),
    post('zh', T0 - 4 * DAY + 3 * H, ['PATRICK']),
    post('le1', T0 - 20 * H, ['LELE']),
    post('le2', T0 + H, ['LELE']),
    post('tc1', T0, ['MEMEWAR']),
    post('tc2', T0 + H, ['PATRICK']),
    post('ca1', T0 + 0.5 * H, ['CALAJO']),
    post('ca2', T0 + H, ['CALAJO']),
    post('mid', T0 + 0.2 * H),
  ];
  const narratives = [
    { id: 'n-tc', members: ['tc1', 'tc2'], formedAtMs: T0 + H },
    { id: 'n-ca', members: ['ca1', 'ca2'], formedAtMs: T0 + 1.2 * H },
    { id: 'n-le', members: ['le1', 'le2'], formedAtMs: T0 + 1.5 * H },
  ];
  const narrativeOf = new Map(narratives.flatMap((x) => x.members.map((m) => [m, x.id] as const)));
  return {
    narratives,
    posts: new Map(posts.map((x) => [x.itemId, x] as const)),
    narrativeOf,
    /* tc2 quotes the Chinese post; ca2 and le2 quote the Turkish one; ca1 and ca2 quote `mid`, which quotes tc1. */
    refs: new Map([['tc2', ['zh']], ['ca2', ['tr', 'mid']], ['le2', ['tr']], ['ca1', ['mid']], ['mid', ['tc1']]]),
    eligible: new Set(['tr', 'zh']),
    shortlist: new Map(),
    vectors: new Map([['tc1', unit(0)], ['tc2', unit(0)], ['ca1', unit(0.7)], ['ca2', unit(0.7)], ['le1', unit(0.5)], ['le2', unit(0.5)], ['tr', unit(0.4)], ['zh', unit(0.2)], ['mid', unit(0.3)]]),
    pictures: new Map(),
    calls: foldNarrativeCalls([]),
    untouchable: new Set(),
    ...over,
  };
}

test('quotes are followed at most maxHops steps', () => {
  const refs = new Map([['a', ['b']], ['b', ['c']], ['c', ['d']]]);
  assert.deepEqual([...linkReach('a', refs, 2)], ['b', 'c']);
});

test('★ the beef: one narrative, started by the Turkish post, the Chinese post in it', () => {
  const plan = traceStories(beef(), P);
  const leads = new Set(['n-tc', 'n-ca', 'n-le'].map((id) => {
    let at = id;
    for (let m = plan.merges.find((x) => x.from === at); m !== undefined; m = plan.merges.find((x) => x.from === at)) at = m.into;
    return at;
  }));
  assert.equal(leads.size, 1, 'all three are one story');
  const lead = [...leads][0] ?? '';
  assert.equal(lead, 'n-le', 'into the one whose first post went up first');
  assert.deepEqual(plan.starts.get(lead)?.map((t) => t.itemId), ['tr', 'zh'], 'earliest first: the Turkish post starts it');
});

test('★ a single quote between two posts is not one story; a post behind it makes it one', () => {
  const two = beef({ narratives: [{ id: 'n-tc', members: ['tc1', 'tc2'], formedAtMs: T0 }, { id: 'n-ca', members: ['ca1', 'ca2'], formedAtMs: T0 }], refs: new Map([['ca1', ['tc1']]]) });
  assert.deepEqual(traceStories(two, P).merges, []);
  const three = { ...two, refs: new Map([['ca1', ['tc1']], ['ca2', ['tc2']]]) };
  assert.equal(traceStories(three, P).merges.length, 1);
});

test('★ never a merge far apart in time, far apart in meaning, or on a narrative the owner called', () => {
  const late = beef({ narratives: beef().narratives.map((x) => (x.id === 'n-le' ? { ...x, formedAtMs: T0 + 3 * DAY } : x)) });
  assert.ok(!traceStories(late, P).merges.some((m) => m.from === 'n-le' || m.into === 'n-le'));
  const far = beef({ vectors: new Map([...beef().vectors, ['le1', unit(2.5)], ['le2', unit(2.5)]]) });
  assert.ok(!traceStories(far, P).merges.some((m) => m.from === 'n-le' || m.into === 'n-le'));
  const called = traceStories(beef({ untouchable: new Set(['n-ca']) }), P);
  assert.ok(!called.merges.some((m) => m.from === 'n-ca' || m.into === 'n-ca'));
});

test('★ a narrative the owner merged still grows: a newer narrative quoting it joins it, never the other way, never against his calls', () => {
  /* He merged the war into n-tc three days ago; its posts are still coming. (Lele, older than both, left out.) */
  const merged = beef({ narratives: beef().narratives.filter((x) => x.id !== 'n-le').map((x) => (x.id === 'n-tc' ? { ...x, formedAtMs: T0 - 3 * DAY } : x)), untouchable: new Set(['n-tc']), receiveOnly: new Set(['n-tc']) });
  const plan = traceStories(merged, P);
  assert.ok(plan.merges.some((m) => m.from === 'n-ca' && m.into === 'n-tc'), 'Calajo (newer) joins his narrative');
  const withLele = traceStories({ ...merged, narratives: [...merged.narratives, ...beef().narratives.filter((x) => x.id === 'n-le')] }, P);
  assert.ok(!withLele.merges.some((m) => m.from === 'n-tc'), 'his narrative is never merged away, even into the older Lele one');
  const frozen = traceStories(beef({ untouchable: new Set(['n-tc']) }), P);
  assert.ok(!frozen.merges.some((m) => m.from === 'n-tc' || m.into === 'n-tc'), 'without receiveOnly it stays as before');
  /* He removed ca1 from beside tc1: the merge would put them back together, so it is not made. */
  const calls = foldNarrativeCalls([{ id: 1, atMs: 1, narrativeId: 'n-tc', verdict: 'remove_post', otherId: 'ca1', coin: null, members: ['tc1', 'ca1'], otherMembers: [] }]);
  assert.ok(!traceStories({ ...merged, calls }, P).merges.some((m) => m.into === 'n-tc'));
});

test('★ a shared start must be one we may start from, inside the lookback: an old famous post ties nothing', () => {
  const old = beef({ posts: new Map([...beef().posts, ['tr', post('tr', T0 - 30 * DAY, ['CATHAT'])]]), refs: new Map([['ca2', ['tr']], ['le2', ['tr']]]) });
  const plan = traceStories(old, P);
  assert.deepEqual(plan.merges, []);
  assert.equal(plan.starts.size, 0);
});

test('a quoted post far from the narrative in meaning is not its start', () => {
  const plan = traceStories(beef({ vectors: new Map([...beef().vectors, ['zh', unit(1.6)]]), refs: new Map([['tc2', ['zh']]]), narratives: [{ id: 'n-tc', members: ['tc1', 'tc2'], formedAtMs: T0 }] }), P);
  assert.equal(plan.starts.size, 0);
});

test('a post the owner removed from beside the narrative is never its start', () => {
  const calls = foldNarrativeCalls([{ id: 1, atMs: T0, narrativeId: 'n-tc', verdict: 'remove_post', otherId: 'zh', coin: null, members: ['tc1', 'tc2', 'zh'], otherMembers: [] }]);
  const plan = traceStories(beef({ calls, refs: new Map([['tc2', ['zh']]]), narratives: [{ id: 'n-tc', members: ['tc1', 'tc2'], formedAtMs: T0 }] }), P);
  assert.equal(plan.starts.size, 0);
});

test('★ a shared name joins an earlier post days back, at the shared-name bar', () => {
  const input = beef({
    narratives: [{ id: 'n-tc', members: ['tc1', 'tc2'], formedAtMs: T0 }],
    refs: new Map(),
    eligible: new Set(['zh']),
    shortlist: new Map([['n-tc', ['zh']]]),
    vectors: new Map([['tc1', unit(0)], ['tc2', unit(0)], ['zh', unit(0.3)]]),
  });
  assert.deepEqual(traceStories(input, P).starts.get('n-tc'), [{ itemId: 'zh', tie: 'name' }]);
  const unlike = { ...input, vectors: new Map([...input.vectors, ['zh', unit(1.2)]]) };
  assert.equal(traceStories(unlike, P).starts.size, 0);
});

test('switched off: no plan', () => {
  const off: Policy = { ...P, narrative: { ...P.narrative, origin: { ...P.narrative.origin, on: false } } };
  assert.deepEqual(traceStories(beef(), off), { merges: [], starts: new Map() });
});

test('★ the viral floor: one post over For You\'s bar carries the narrative; small or unread posts never do', () => {
  const big = { readings: [{ atMs: T0 + DAY, reach: P.rising.fypMinReach }], postedAtMs: T0, scale: 1 };
  const small = { readings: [{ atMs: T0 + DAY, reach: P.rising.fypMinReach - 1 }], postedAtMs: T0, scale: 1 };
  const unread = { readings: [], postedAtMs: T0, scale: 1 };
  assert.equal(standsOnViralPost([small, big], P), true);
  assert.equal(standsOnViralPost([small, small, unread], P), false);
  const off: Policy = { ...P, narrative: { ...P.narrative, origin: { ...P.narrative.origin, viralFloor: false } } };
  assert.equal(standsOnViralPost([small], off), true);
});

/* ── policy.v145: the "Vegeta is Algerian" war of 21–22 Oct as it was stored ── */

/*
 * A narrative of the Japanese post and the French one quoting it (both named PIG). @liistrk's origin
 * was judged "not a meme"; @Badr_13Block quotes it; @rayaneAlg00 quotes nothing and says "végéta
 * est algérien". Their measured distances to the narrative's average: the origin 0.36, Badr 0.59,
 * Rayane 0.66.
 */
function vegeta(over: Partial<OriginInput> = {}): OriginInput {
  const posts: NarrativePost[] = [
    { itemId: 'li', atMs: T0 - 22 * H, text: 'les japonais ils sont au courant que végéta est algérien ?', names: [], hasPicture: false },
    { itemId: 'mo', atMs: T0, text: 'ベジータがアルジェリア人ではない最大の証拠がコチラ https://t.co/x', names: ['PIG'], hasPicture: true },
    { itemId: 'ra', atMs: T0 + 3 * H, text: 'Les japonais quand tu leurs dit que végéta est algérien et que piccolo est malien https://t.co/y', names: ['HOMER'], hasPicture: true },
    { itemId: 'ba', atMs: T0 + 10 * H, text: 'Quand ils vont découvrir que Picolo est Malien ils vont serrer https://t.co/z', names: ['VEGETA'], hasPicture: true },
    { itemId: 'ya', atMs: T0 + 12 * H, text: "C'est pour ca on vous dis de lire le manga avant de regarder l'animé...", names: ['PIG'], hasPicture: true },
    /* Two hundred other posts, so a phrase two of these say is rare among them. */
    ...Array.from({ length: 200 }, (_, i) => ({ itemId: `o${i}`, atMs: T0, text: `elon musk posted another dog picture number ${i}`, names: [], hasPicture: false })),
  ];
  return {
    narratives: [{ id: 'n-pig', members: ['mo', 'ya'], formedAtMs: T0 + 12 * H }],
    posts: new Map(posts.map((x) => [x.itemId, x] as const)),
    narrativeOf: new Map([['mo', 'n-pig'], ['ya', 'n-pig']]),
    refs: new Map(),
    /* The quotes: the Japanese post → the origin, Yanox → the Japanese post, Badr → the origin. */
    reproductions: new Map([['mo', ['li']], ['ya', ['mo']], ['ba', ['li']]]),
    eligible: new Set(),
    rootable: new Set(['li']),
    loose: ['ra', 'ba'],
    looseViral: new Set(['ra', 'ba']),
    shortlist: new Map(),
    vectors: new Map([['mo', unit(0)], ['ya', unit(0)], ['li', unit(1.2)], ['ba', unit(0.94)], ['ra', unit(0.85)]]),
    pictures: new Map(),
    calls: foldNarrativeCalls([]),
    untouchable: new Set(),
    ...over,
  };
}

test('★ the Vegeta war: one narrative, started by the post the judge said no to, with the two that quote it or say its words', () => {
  const plan = traceStories(vegeta(), P);
  assert.deepEqual(plan.starts.get('n-pig'), [{ itemId: 'li', tie: 'root' }]);
  assert.deepEqual(plan.joins?.get('n-pig'), [{ itemId: 'ra', tie: 'phrase' }, { itemId: 'ba', tie: 'quoted' }]);
  assert.deepEqual(plan.merges, []);
});

test('★ the Vegeta war as the regroup really made it: the French pair, the Japanese post and Yanox loose — all five in one', () => {
  /* On 22 Oct the regroup grouped @rayaneAlg00 and @Badr_13Block; only Badr's quote of the origin is a member's. */
  const real = vegeta({
    narratives: [{ id: 'n-fr', members: ['ra', 'ba'], formedAtMs: T0 + 10 * H }],
    narrativeOf: new Map([['ra', 'n-fr'], ['ba', 'n-fr']]),
    loose: ['mo', 'ya'],
    looseViral: new Set(['mo', 'ya']),
    vectors: new Map([['ra', unit(0)], ['ba', unit(0)], ['li', unit(1.13)], ['mo', unit(0.9)], ['ya', unit(0.86)]]),
  });
  const plan = traceStories(real, P);
  assert.deepEqual(plan.starts.get('n-fr'), [{ itemId: 'li', tie: 'root' }], 'Badr and the two loose posts quoting it make three');
  assert.deepEqual(plan.joins?.get('n-fr'), [{ itemId: 'mo', tie: 'quoted' }, { itemId: 'ya', tie: 'quoted' }]);
  const smallLoose = traceStories({ ...real, looseViral: new Set() }, P);
  assert.equal(smallLoose.starts.size, 0, 'small loose posts never vouch for a root');
});

test('★ a quote root needs two posts quoting it, and must be one the caller lets root', () => {
  const once = traceStories(vegeta({ reproductions: new Map([['mo', ['li']]]), loose: [] }), P);
  assert.equal(once.starts.size, 0, 'one quote is a comparison, not a start');
  const notRootable = traceStories(vegeta({ rootable: new Set(), loose: [] }), P);
  assert.equal(notRootable.starts.size, 0, 'not viral, or the owner called it Not a meme: the caller leaves it out');
  const off: Policy = { ...P, narrative: { ...P.narrative, origin: { ...P.narrative.origin, rootOn: false } } };
  assert.equal(traceStories(vegeta({ loose: [] }), off).starts.size, 0);
});

test('★ the quotes start and join, never merge: two narratives tied only by quotes stay two', () => {
  const two = vegeta({
    narratives: [{ id: 'n-pig', members: ['mo', 'ya'], formedAtMs: T0 }, { id: 'n-b', members: ['ba', 'ra'], formedAtMs: T0 }],
    narrativeOf: new Map([['mo', 'n-pig'], ['ya', 'n-pig'], ['ba', 'n-b'], ['ra', 'n-b']]),
    reproductions: new Map([['mo', ['ba']], ['ya', ['ra']], ['ba', ['mo']]]),
    rootable: new Set(),
    loose: [],
  });
  assert.deepEqual(traceStories(two, P).merges, []);
});

test('★ a loose post joins only when viral, close enough, and quoting the story or saying a rare phrase of it', () => {
  const small = traceStories(vegeta({ looseViral: new Set() }), P);
  assert.equal(small.joins?.size ?? 0, 0, 'a small post joins by the regroup, not by these ties');
  const far = traceStories(vegeta({ vectors: new Map([...vegeta().vectors, ['ra', unit(1.1)], ['ba', unit(1.3)]]) }), P);
  assert.equal(far.joins?.size ?? 0, 0);
  /* The same phrase said by every other post is not rare: it ties nothing. */
  const common = vegeta({
    loose: ['ra'],
    posts: new Map([...vegeta().posts].map(([id, x]) => [id, id.startsWith('o') ? { ...x, text: 'végéta est algérien' } : x] as const)),
  });
  assert.equal(traceStories(common, P).joins?.size ?? 0, 0);
});

/* ── policy.v149: the merge on the story's own words — the Yotsuya station goats, 19–23 Oct ── */

/* Three Japanese narratives about JR East's weeding goats at Yotsuya station, quoting nothing, as they
   stood on 23 Oct; @JREast_official's post (19 Oct) is the first. `o1…` are unrelated posts read beside
   them, so a word is rare among many, as in the pass. */
function goats(over: Partial<OriginInput> = {}): OriginInput {
  const text = (itemId: string, atMs: number, body: string): NarrativePost => ({ ...post(itemId, atMs), text: body });
  const posts = [
    text('jre', T0 - 4 * DAY, '四ツ谷駅にヤギが登場 環境にやさしい除草方法として、ヤギによる除草を試験的に行っています'),
    text('fuu', T0 - 2 * DAY, '“勤務するヤギ”に通行人も夢中 山手線内側の四ツ谷駅前で初めて除草作業'),
    text('tks', T0 - DAY, '夫の会社、ヤギの除草ブームに乗っかって2匹のヤギをレンタルしたけど'),
    text('lov', T0 - 20 * H, '四谷のオフィス街に除草目的のヤギが投入されててめっちゃ和む'),
    text('mim', T0 - 2 * H, 'JR四ツ谷駅のレンタルヤギさん 駅周辺の除草のお仕事中'),
    ...Array.from({ length: 1_000 }, (_, i) => text(`o${i}`, T0, `unrelated post number ${i} about the market today`)),
  ];
  const narratives = [
    { id: 'n-keep', members: ['fuu'], formedAtMs: T0 - DAY },
    { id: 'n-pets', members: ['jre', 'tks'], formedAtMs: T0 },
    { id: 'n-jr', members: ['lov', 'mim'], formedAtMs: T0 + 6 * H },
  ];
  return {
    narratives,
    posts: new Map(posts.map((x) => [x.itemId, x] as const)),
    narrativeOf: new Map(narratives.flatMap((x) => x.members.map((m) => [m, x.id] as const))),
    refs: new Map(),
    eligible: new Set(),
    shortlist: new Map(),
    vectors: new Map([['jre', unit(0)], ['fuu', unit(0.4)], ['tks', unit(0.3)], ['lov', unit(0.2)], ['mim', unit(0.1)]]),
    pictures: new Map(),
    calls: foldNarrativeCalls([]),
    untouchable: new Set(),
    ...over,
  };
}
const leadOf = (plan: ReturnType<typeof traceStories>, id: string): string => {
  let at = id;
  for (let m = plan.merges.find((x) => x.from === at); m !== undefined; m = plan.merges.find((x) => x.from === at)) at = m.into;
  return at;
};

test('★ the Yotsuya goats: three narratives quoting nothing become one, started by JR East', () => {
  const plan = traceStories(goats(), P);
  const leads = new Set(['n-keep', 'n-pets', 'n-jr'].map((id) => leadOf(plan, id)));
  assert.deepEqual([...leads], ['n-pets'], 'one story, under the narrative holding the first post (JR East, 19 Oct)');
  assert.ok(plan.merges.every((m) => m.why === 'words'));
  assert.ok(plan.merges.some((m) => (m.words ?? []).includes('ヤギ') && (m.words ?? []).includes('除草')), 'goat and weeding, in any run they sit in');
});

test('★ words alone are not enough: one shared word, far in meaning, days apart, or said by many stories', () => {
  const one: Policy = { ...P, narrative: { ...P.narrative, origin: { ...P.narrative.origin, wordsMinShared: 99 } } };
  assert.deepEqual(traceStories(goats(), one).merges, []);
  const far = goats({ vectors: new Map([...goats().vectors, ['lov', unit(1.6)], ['mim', unit(1.7)]]) });
  assert.ok(!traceStories(far, P).merges.some((m) => m.from === 'n-jr' || m.into === 'n-jr'), 'not alike: stays apart');
  const late = goats({ narratives: goats().narratives.map((x) => (x.id === 'n-jr' ? { ...x, formedAtMs: T0 + 5 * DAY } : x)) });
  assert.ok(!traceStories(late, P).merges.some((m) => m.from === 'n-jr' || m.into === 'n-jr'), 'formed more than four days apart');
  /* The same words said by four more narratives (far in meaning, so never merged themselves) mark none of them. */
  const many = goats();
  const others = ['x1', 'x2', 'x3', 'x4'].map((id) => ({ id: `n-${id}`, members: [id], formedAtMs: T0 }));
  const crowded: OriginInput = {
    ...many,
    narratives: [...many.narratives, ...others],
    posts: new Map([...many.posts, ...others.map((x) => [x.members[0] ?? '', { ...post(x.members[0] ?? '', T0), text: '四ツ谷駅のレンタルヤギが除草' }] as const)]),
    narrativeOf: new Map([...many.narrativeOf, ...others.map((x) => [x.members[0] ?? '', x.id] as const)]),
    vectors: new Map([...many.vectors, ...others.map((x) => [x.members[0] ?? '', unit(2.5)] as const)]),
  };
  assert.deepEqual(traceStories(crowded, P).merges, []);
});

test('★ a word one post in a big narrative says is not that narrative\'s word', () => {
  const blob = goats();
  const filler = Array.from({ length: 12 }, (_, i) => `o${i}`);
  const input: OriginInput = {
    ...blob,
    narratives: blob.narratives.map((x) => (x.id === 'n-jr' ? { ...x, members: [...x.members, ...filler] } : x)),
    narrativeOf: new Map([...blob.narrativeOf, ...filler.map((m) => [m, 'n-jr'] as const)]),
    vectors: new Map([...blob.vectors, ...filler.map((m) => [m, unit(0.15)] as const)]),
  };
  assert.ok(!traceStories(input, P).merges.some((m) => m.from === 'n-jr' || m.into === 'n-jr'));
});

test('★ never against the owner: a narrative he called, or posts he kept apart, stay apart', () => {
  const called = traceStories(goats({ untouchable: new Set(['n-jr']) }), P);
  assert.ok(!called.merges.some((m) => m.from === 'n-jr' || m.into === 'n-jr'));
  const apart = foldNarrativeCalls([{ id: 1, atMs: T0, narrativeId: 'n-jr', verdict: 'split', otherId: 'n-jr2', coin: null, members: ['lov', 'mim'], otherMembers: ['jre', 'tks'] }]);
  const kept = traceStories(goats({ calls: apart }), P);
  assert.ok(!kept.merges.some((m) => (m.from === 'n-jr' && m.into === 'n-pets') || (m.from === 'n-pets' && m.into === 'n-jr')));
  const off: Policy = { ...P, narrative: { ...P.narrative, origin: { ...P.narrative.origin, wordsOn: false } } };
  assert.deepEqual(traceStories(goats(), off).merges, []);
});
