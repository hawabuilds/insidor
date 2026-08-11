/**
 * Recorded vendor payloads, trimmed to the fields we read plus a few we do not
 * (deliberately: the decoder has to survive fields it has never seen).
 *
 * These are the samples the conformance suite runs the adapter against. They
 * are `unknown` on purpose — the whole point of the translation layer is that
 * it cannot assume its input is well shaped.
 */

/** A plain post with every counter present. */
const plain: unknown = {
  id: '1823456789012345678',
  id_str: '1823456789012345678',
  url: 'https://x.com/someone/status/1823456789012345678',
  text: 'the chill guy just standing there with his hands in his pockets #chillguy',
  createdAt: 'Tue Aug 05 07:00:30 +0000 2026',
  lang: 'en',
  viewCount: 1_240_000,
  likeCount: 8_431,
  replyCount: 219,
  retweetCount: 1_902,
  quoteCount: 341,
  bookmarkCount: 2_774,
  author: { id: '44196397', userName: 'someone', followers: 21_400 },
  entities: {
    hashtags: [{ text: 'chillguy' }],
    symbols: [{ text: 'CHILL' }],
  },
  extendedEntities: {
    media: [
      {
        type: 'photo',
        media_url_https: 'https://pbs.twimg.com/media/abc.jpg',
        sizes: { large: { w: 1200, h: 900 } },
      },
    ],
  },
  // A field we do not read today. Its presence must not change anything.
  possibly_sensitive: false,
};

/** A reproduction: a new authored object pointing at an older one. */
const quote: unknown = {
  id: '1823499999999999999',
  text: 'someone made a coin of this already',
  createdAt: 'Tue Aug 05 07:04:11 +0000 2026',
  lang: 'en',
  viewCount: 12_300,
  likeCount: 88,
  replyCount: 4,
  retweetCount: 12,
  quoteCount: 0,
  bookmarkCount: 9,
  author: { id: '99887766' },
  quoted_tweet: { id: '1823456789012345678' },
  entities: {},
};

/** A rebroadcast: zero new authorship, and it must not be counted as one. */
const rebroadcast: unknown = {
  id: '1823511111111111111',
  text: 'RT @someone: the chill guy just standing there',
  createdAt: 'Tue Aug 05 07:09:02 +0000 2026',
  lang: 'en',
  viewCount: 900,
  likeCount: 0,
  replyCount: 0,
  retweetCount: 1_902,
  quoteCount: 0,
  bookmarkCount: 0,
  author: { id: '12341234' },
  retweeted_tweet: { id: '1823456789012345678' },
  entities: {},
};

/** A hostile payload: missing author, missing counters, junk types. */
const degraded: unknown = {
  id: '1823522222222222222',
  text: '',
  createdAt: 'not a date',
  viewCount: 'n/a',
  likeCount: null,
  author: null,
  entities: null,
};

export const SAMPLES: readonly unknown[] = [plain, quote, rebroadcast, degraded];
export const PLAIN = plain;
export const QUOTE = quote;
export const REBROADCAST = rebroadcast;
export const DEGRADED = degraded;
