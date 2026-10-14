import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Millis } from '@insidor/contracts';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { descriptionMatch, linksAccount, linksPost, matchPostCoin, nameMatch, pictureVerdict, postPictureVerdict, skeleton, type CoinSide, type MatchBars } from './post-coin.ts';

const PC = DEFAULT_POLICY.postCoin;
const BARS: MatchBars = {
  launchAllowanceMs: 600_000, windowMs: 172_800_000, minLinkIdLength: 8, minVariantLength: 4,
  sameHashDistance: PC.sameHashDistance, pictureFloor: PC.pictureFloor, timingHalfLifeMin: PC.timingHalfLifeMin,
  descriptionMinWord: PC.descriptionMinWord, likelyMinShare: PC.likelyMinShare, weights: PC.weights,
};
const POSTED = 1_000_000_000_000 as Millis;
const post = { postedAt: POSTED, linkIds: ['2080077693593223329', 'HM1lpuvXMAARRu1'], names: ['Aura Bird', 'Stork'] };
const coin = (over: Partial<CoinSide>): CoinSide => ({
  address: 'A', name: 'Aura Bird', ticker: 'AURA', launchedAt: (POSTED + 720_000) as Millis, links: [], samePicture: null, ...over,
});

describe('name matching', () => {
  it('is exact once spaces, case and a leading "the" go', () => {
    assert.equal(nameMatch(['Moo Deng'], { name: 'MOODENG', ticker: null }, BARS), 'exact');
    assert.equal(nameMatch(['The Stork'], { name: null, ticker: 'STORK' }, BARS), 'exact');
  });
  it('is a variant for a nickname spelled without its vowels', () => {
    assert.equal(skeleton('Peanut'), skeleton('PNUT'));
    assert.equal(nameMatch(['Peanut'], { name: null, ticker: 'PNUT' }, BARS), 'variant');
  });
  it('★ is a variant for a short form, a longer name holding it, a misspelling, or words the post itself says', () => {
    assert.equal(nameMatch(['Goliath'], { name: null, ticker: 'GOLI' }, BARS), 'variant');
    assert.equal(nameMatch(['Goliath'], { name: 'RIP Goliath', ticker: 'RIPGOLIATH' }, BARS), 'variant');
    assert.equal(nameMatch(['Goliath'], { name: 'Golaith', ticker: null }, BARS), 'variant', 'vowels swapped: the same skeleton');
    assert.equal(nameMatch(['Goliath'], { name: 'Gxliath', ticker: null }, BARS), 'variant', 'one letter changed');
    assert.equal(nameMatch(['Cat'], { name: 'Cut', ticker: null }, BARS), 'none', 'too short to be a misspelling');
    assert.equal(nameMatch(['Goliath'], { name: 'Goliat', ticker: null }, BARS), 'variant');
    assert.equal(nameMatch(['Goliath'], { name: 'Six Flags', ticker: 'SIXFLAGS' }, BARS, 'Goliath at Six Flags tonight'), 'variant');
    assert.equal(nameMatch(['Goliath'], { name: 'Six Flags', ticker: 'SIXFLAGS' }, BARS), 'none');
  });
  it('is none for a different word, and short names never count as variants', () => {
    assert.equal(nameMatch(['Aura Bird'], { name: 'Dog', ticker: 'DOG' }, BARS), 'none');
    assert.equal(nameMatch(['Cat'], { name: 'Cut', ticker: null }, BARS), 'none');
  });
});

describe('links', () => {
  it('finds the post id as a whole token in a link, never inside a longer number', () => {
    assert.equal(linksPost(['https://example.test/a/status/2080077693593223329?s=20'], post.linkIds, BARS), true);
    assert.equal(linksPost(['https://example.test/a/status/20800776935932233291'], post.linkIds, BARS), false);
  });
  it('is unknown when the links were not read', () => {
    assert.equal(linksPost(null, post.linkIds, BARS), null);
  });
});

describe('the account and the words', () => {
  it("finds the poster's own account in a coin's links, its profile or a post of its own", () => {
    assert.equal(linksAccount(['https://social.example/blknoiz06'], 'blknoiz06'), true);
    assert.equal(linksAccount(['https://social.example/Blknoiz06/status/1'], 'blknoiz06'), true);
    assert.equal(linksAccount(['https://www.video.example/@cazy.chan/video/1'], 'cazy.chan'), true);
    assert.equal(linksAccount(['https://social.example/blknoiz06x'], 'blknoiz06'), false);
    assert.equal(linksAccount(null, 'blknoiz06'), null);
    assert.equal(linksAccount(['https://social.example/a'], null), null);
  });
  it("measures the share of the description's words the post says, links dropped", () => {
    assert.equal(descriptionMatch('TOTAL BEAR DEATH', 'total bear death incoming', BARS), 1);
    assert.equal(descriptionMatch('Bear market https://x.test/bear', 'bear', BARS), 0.5);
    assert.equal(descriptionMatch(null, 'x', BARS), null);
  });
});

describe('picture verdict', () => {
  const bars = { nearIdentical: 0.95, borderline: 0.72 };
  it('near-identical is the same picture; borderline only with the judge', () => {
    assert.equal(pictureVerdict(0.97, null, bars), true);
    assert.equal(pictureVerdict(0.8, null, bars), null);
    assert.equal(pictureVerdict(0.8, true, bars), true);
    assert.equal(pictureVerdict(0.5, true, bars), false);
    assert.equal(pictureVerdict(null, true, bars), null);
  });
  it('★ for a post\'s coin only near-identical is the same picture: the judge\'s "same subject" leaves it unknown, its no is a no', () => {
    assert.equal(postPictureVerdict(0.97, null, bars), true);
    assert.equal(postPictureVerdict(0.8, 'yes', bars), null);
    assert.equal(postPictureVerdict(0.8, 'no', bars), false);
    assert.equal(postPictureVerdict(0.5, 'yes', bars), false);
  });
});

describe('matchPostCoin', () => {
  it('is confident on the one coin that links the post, whatever else exists', () => {
    const r = matchPostCoin(post, [coin({ address: 'A' }), coin({ address: 'B', links: ['https://example.test/a/status/2080077693593223329'] })], BARS);
    assert.equal(r.kind, 'confident');
    assert.equal(r.kind === 'confident' && r.address, 'B');
    assert.equal(r.kind === 'confident' && r.because, 'links');
  });

  it('is unsure when two coins both link the post: copycats link the viral post too', () => {
    const link = ['https://example.test/a/status/2080077693593223329'];
    assert.equal(matchPostCoin(post, [coin({ address: 'A', links: link }), coin({ address: 'B', links: link })], BARS).kind, 'unsure');
  });

  it('is confident on same picture plus timing, and never on a picture alone', () => {
    const late = (POSTED + 3 * 86_400_000) as Millis;
    assert.equal(matchPostCoin(post, [coin({ address: 'A', samePicture: true }), coin({ address: 'B', samePicture: false })], BARS).kind, 'confident');
    const other = coin({ address: 'B', name: 'Dog', ticker: 'DOG' });
    assert.equal(matchPostCoin(post, [coin({ address: 'A', samePicture: true, launchedAt: late }), other], BARS).kind, 'unsure');
  });

  it('never matches a coin launched before the post', () => {
    const before = (POSTED - 3_600_000) as Millis;
    const r = matchPostCoin(post, [coin({ address: 'A', launchedAt: before, links: ['https://example.test/a/status/2080077693593223329'] })], BARS);
    assert.equal(r.kind, 'unsure');
  });

  it('★ is unsure on the one same picture while another coin in the window was never compared', () => {
    assert.equal(matchPostCoin(post, [coin({ address: 'A', samePicture: true }), coin({ address: 'B' })], BARS).kind, 'unsure');
  });

  it('★ never confident on a name: launched after, exact, and the only coin of the name is still unsure', () => {
    assert.equal(matchPostCoin(post, [coin({ address: 'A' })], BARS).kind, 'unsure');
    assert.equal(matchPostCoin(post, [coin({ address: 'A', samePicture: false })], BARS).kind, 'unsure');
  });

  it('ranks by score, then the earliest launch, and puts coins launched before the post last', () => {
    const r = matchPostCoin(
      post,
      [
        coin({ address: 'before', launchedAt: (POSTED - 3_600_000) as Millis }),
        coin({ address: 'late', launchedAt: (POSTED + 7_200_000) as Millis }),
        coin({ address: 'early', launchedAt: (POSTED + 60_000) as Millis }),
      ],
      BARS,
    );
    assert.equal(r.kind, 'unsure');
    assert.deepEqual(r.kind === 'unsure' && r.ranked.map((e) => e.address), ['early', 'late', 'before']);
  });

  it('★ is confident on the one coin whose picture hashes the same as the post, launched after it', () => {
    const r = matchPostCoin(post, [coin({ address: 'A', hashDistance: 2 }), coin({ address: 'B', hashDistance: 30 })], BARS);
    assert.equal(r.kind === 'confident' && r.because, 'pictureAndTiming');
    assert.equal(r.kind === 'confident' && r.address, 'A');
  });

  it("★ is confident on the one coin whose address the poster's own account posted, and not on others posting it", () => {
    const own = matchPostCoin(post, [coin({ address: 'A', addressByAuthor: true, addressByOthers: 0 }), coin({ address: 'B', addressByAuthor: false })], BARS);
    assert.equal(own.kind === 'confident' && own.because, 'authorPostedAddress');
    const others = matchPostCoin(post, [coin({ address: 'A', addressByAuthor: false, addressByOthers: 5 }), coin({ address: 'B', addressByAuthor: false })], BARS);
    assert.equal(others.kind, 'unsure');
  });

  it('★ a likely coin is never confident, and an unknown adds nothing to the score', () => {
    const r = matchPostCoin(post, [coin({ address: 'A', pictureSimilarity: 0.9, launchedAt: (POSTED + 60_000) as Millis })], BARS);
    assert.equal(r.kind, 'unsure');
    const bare = matchPostCoin(post, [coin({ address: 'A' })], BARS);
    const known = matchPostCoin(post, [coin({ address: 'A', pictureSimilarity: null, hashDistance: null, addressByAuthor: null })], BARS);
    assert.equal(bare.kind === 'unsure' && bare.ranked[0]?.score, known.kind === 'unsure' && known.ranked[0]?.score);
  });

  it('is none with no coins at all', () => {
    assert.equal(matchPostCoin(post, [], BARS).kind, 'none');
  });
});

describe('2026-10-14: copycat links (held-out gold: one more right, no new wrong)', () => {
  const link = ['https://social.example/someone/status/2080077693593223329'];
  const DAY = 86_400_000;
  it('★ several coins link the post: the only one launched inside the window is proven (Himgajria)', () => {
    const r = matchPostCoin(post, [coin({ address: 'ORIGIN', links: link }), coin({ address: 'LATE1', links: link, launchedAt: (POSTED + 104 * DAY) as Millis }), coin({ address: 'LATE2', links: link, launchedAt: (POSTED + 104 * DAY) as Millis })], BARS);
    assert.equal(r.kind, 'confident');
    assert.equal(r.kind === 'confident' ? r.address : null, 'ORIGIN');
  });
  it('two linking coins inside the window are still a tie', () => {
    const r = matchPostCoin(post, [coin({ address: 'A', links: link }), coin({ address: 'B', links: link, launchedAt: (POSTED + 3_600_000) as Millis })], BARS);
    assert.equal(r.kind, 'unsure');
  });
});
