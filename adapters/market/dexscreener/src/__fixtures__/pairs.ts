/**
 * Recorded vendor responses, taken from the measurement that found the bug.
 *
 * `CURVE_RESPONSE` has no `liquidity` key at all. `DRAINED_RESPONSE` has one,
 * and its value is zero. Those two fixtures next to each other are the whole
 * argument for why absence and zero must not be the same value.
 */

/** A bonding-curve pair: no liquidity object exists, because there is no reserve. */
export const CURVE_RESPONSE: unknown = {
  pairs: [
    {
      chainId: 'solana',
      dexId: 'pumpfun',
      pairAddress: 'Cur1vePa1rAddre55111111111111111111111111111',
      priceUsd: '0.0000214',
      fdv: 21_400,
      pairCreatedAt: 1_785_913_400_000,
      // no `liquidity` key. This is the measured shape, not an omission.
      // No `priceChange` key either, for a second reason of the same shape: this
      // pair is minutes old and has no trailing day to have changed over. A coin
      // that has not existed for a day did not hold flat for one.
    },
  ],
};

/** A pooled pair that has actually been drained. Zero is a real reading. */
export const DRAINED_RESPONSE: unknown = {
  pairs: [
    {
      chainId: 'solana',
      dexId: 'raydium',
      pairAddress: 'Dra1nedPa1rAddre5511111111111111111111111111',
      priceUsd: '0.00000001',
      marketCap: 12,
      liquidity: { usd: 0, base: 0, quote: 0 },
      pairCreatedAt: 1_770_000_000_000,
    },
  ],
};

/** A healthy pooled token across two pools. */
export const POOLED_RESPONSE: unknown = {
  pairs: [
    {
      chainId: 'solana',
      dexId: 'raydium',
      pairAddress: 'Poo1Pa1rAddre55111111111111111111111111111',
      priceUsd: '0.0031',
      marketCap: 61_000,
      fdv: 61_000,
      liquidity: { usd: 42_000 },
      priceChange: { m5: 0.4, h1: 1.2, h6: 5.8, h24: 12.5 },
      pairCreatedAt: 1_780_500_000_000,
    },
    {
      chainId: 'solana',
      dexId: 'orca',
      pairAddress: 'Poo1Pa1rAddre55222222222222222222222222222',
      priceUsd: '0.0031',
      marketCap: 61_000,
      liquidity: { usd: 9_100 },
      /* Deliberately a DIFFERENT h24 from the deeper pool above. A change is a
         change in a price, so it has to come from the pair the price came from;
         if this number is ever the one that surfaces, the row is showing one
         market's price beside another market's move. */
      priceChange: { h24: -3.1 },
      pairCreatedAt: 1_781_000_000_000,
    },
  ],
};

/** The token is unknown to this vendor. Not an error, and not a zero. */
export const EMPTY_RESPONSE: unknown = { pairs: [] };

/**
 * A whole live pair, recorded 14 August 2026, with the noise left in.
 *
 * The mappers read six of these fields and must go on ignoring the rest. Three
 * of them are wire poison and are here as a standing test that they never move:
 * `url` and `info.imageUrl` are vendor URLs, and the projector throws on any
 * string carrying this vendor's name at any depth — an image has to be
 * re-hosted, never linked, and a row that leaks one is silently withheld from
 * the board rather than failing loudly.
 *
 * This is the shape AFTER the client, which is why every pair here is one whose
 * base side is the token we asked about. The vendor's own answer also contains
 * pairs in which the token is the QUOTE side, carrying another coin's price and
 * another coin's market cap; the client drops those, and nothing downstream
 * would be able to tell if it stopped.
 */
export const LIVE_RESPONSE: unknown = {
  pairs: [
    {
      chainId: 'solana',
      dexId: 'raydium',
      url: 'https://dexscreener.com/solana/93tjgwff5ac5thymi8c4wejvvqq4tumemuyw1leyz7bu',
      pairAddress: '93tjgwff5Ac5ThyMi8C4WejVVQq4tuMeMuYW1LEYZ7bu',
      baseToken: {
        address: 'Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump',
        name: 'Just a chill guy',
        symbol: 'CHILLGUY',
      },
      quoteToken: { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL' },
      priceNative: '0.0001376',
      priceUsd: '0.01035',
      txns: { m5: { buys: 8, sells: 1 }, h24: { buys: 689, sells: 683 } },
      volume: { h24: 90_362.98, h1: 6570.45 },
      priceChange: { m5: 0.07, h1: 0.1, h6: -1.52, h24: -6.94 },
      liquidity: { usd: 1_080_054.03, base: 52_075_439, quote: 7183.4766 },
      fdv: 10_356_698,
      marketCap: 10_356_698,
      pairCreatedAt: 1_731_701_302_000,
      info: {
        imageUrl: 'https://cdn.dexscreener.com/cms/images/20ae19e2.png',
        socials: [{ url: 'https://x.com/chillguycto', type: 'twitter' }],
      },
    },
    {
      // Same token, a real pool on another venue, two orders of magnitude
      // thinner. It is why depth decides the price and volume does not.
      chainId: 'solana',
      dexId: 'orca',
      pairAddress: '4Eq688gAJRJiRzhFR4tKpVyRhknDvC8UkqsLmfsEzFFX',
      baseToken: { address: 'Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump', symbol: 'CHILLGUY' },
      priceUsd: '0.01037',
      liquidity: { usd: 2069.64 },
      fdv: 10_370_277,
      marketCap: 10_370_277,
      pairCreatedAt: 1_731_800_000_000,
    },
    {
      // Also measured live: a pooled venue can send a pair with NO liquidity
      // key and no price at all. Absent is not zero here either.
      chainId: 'solana',
      dexId: 'meteora',
      pairAddress: 'GGkxZF5NCkNBDiebqaVPNkLP4HjWmFJXBb7t5MNRMZMz',
      baseToken: { address: 'Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump', symbol: 'CHILLGUY' },
      pairCreatedAt: 1_760_000_000_000,
    },
  ],
};
