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
      pairCreatedAt: 1_780_500_000_000,
    },
    {
      chainId: 'solana',
      dexId: 'orca',
      pairAddress: 'Poo1Pa1rAddre55222222222222222222222222222',
      priceUsd: '0.0031',
      marketCap: 61_000,
      liquidity: { usd: 9_100 },
      pairCreatedAt: 1_781_000_000_000,
    },
  ],
};

/** The token is unknown to this vendor. Not an error, and not a zero. */
export const EMPTY_RESPONSE: unknown = { pairs: [] };
