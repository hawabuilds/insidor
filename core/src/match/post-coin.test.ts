import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Millis } from '@insidor/contracts';

import { linksPost, matchPostCoin, nameMatch, pictureVerdict, skeleton, type CoinSide, type MatchBars } from './post-coin.ts';

const BARS: MatchBars = { launchAllowanceMs: 600_000, windowMs: 172_800_000, minLinkIdLength: 8, minVariantLength: 4 };
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

describe('picture verdict', () => {
  const bars = { nearIdentical: 0.95, borderline: 0.72 };
  it('near-identical is the same picture; borderline only with the judge', () => {
    assert.equal(pictureVerdict(0.97, null, bars), true);
    assert.equal(pictureVerdict(0.8, null, bars), null);
    assert.equal(pictureVerdict(0.8, true, bars), true);
    assert.equal(pictureVerdict(0.5, true, bars), false);
    assert.equal(pictureVerdict(null, true, bars), null);
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
    assert.equal(matchPostCoin(post, [coin({ address: 'A', samePicture: true }), coin({ address: 'B' })], BARS).kind, 'confident');
    const other = coin({ address: 'B', name: 'Dog', ticker: 'DOG' });
    assert.equal(matchPostCoin(post, [coin({ address: 'A', samePicture: true, launchedAt: late }), other], BARS).kind, 'unsure');
  });

  it('never matches a coin launched before the post', () => {
    const before = (POSTED - 3_600_000) as Millis;
    const r = matchPostCoin(post, [coin({ address: 'A', launchedAt: before, links: ['https://example.test/a/status/2080077693593223329'] })], BARS);
    assert.equal(r.kind, 'unsure');
  });

  it('is confident on timing and an exact name only when it is the only coin of the name at all', () => {
    const before = coin({ address: 'B', launchedAt: (POSTED - 3_600_000) as Millis });
    assert.equal(matchPostCoin(post, [coin({ address: 'A' }), before], BARS).kind, 'unsure');
    assert.equal(matchPostCoin(post, [coin({ address: 'A' })], BARS).kind, 'confident');
    assert.equal(matchPostCoin(post, [coin({ address: 'A' }), coin({ address: 'B', name: 'AuraBirdy', ticker: null })], BARS).kind, 'unsure');
    assert.equal(matchPostCoin(post, [coin({ address: 'A', samePicture: false })], BARS).kind, 'unsure');
  });

  it('ranks by evidence, then the earliest launch, and puts coins launched before the post last', () => {
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

  it('is none with no coins at all', () => {
    assert.equal(matchPostCoin(post, [], BARS).kind, 'none');
  });
});
