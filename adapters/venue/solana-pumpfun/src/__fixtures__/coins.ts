/**
 * Recorded venue payloads.
 *
 * Note what is not here: a `liquidity` object. There is none, on any coin, ever
 * — the venue has no two-sided reserve. This fixture is the evidence for the
 * one rule the read path exists to keep.
 */

/** A live pre-graduation coin, minutes old. */
export const FRESH_COIN: unknown = {
  mint: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
  name: 'chill guy',
  symbol: 'CHILL',
  description: 'just a chill guy',
  image_uri: 'https://example.invalid/chill.png',
  creator: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  created_timestamp: 1_785_912_090_000,
  virtual_sol_reserves: 30_450_000_000,
  virtual_token_reserves: 1_060_000_000_000_000,
  real_sol_reserves: 450_000_000,
  complete: false,
  usd_market_cap: 21_400,
  twitter: 'https://x.com/someone/status/1823456789012345678',
  website: null,
  telegram: null,
};

/** A graduated coin: the curve is done and the market has moved to a pool. */
export const GRADUATED_COIN: unknown = {
  mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  name: 'gym showdown',
  symbol: 'GYM',
  created_timestamp: 1_780_000_000_000,
  virtual_sol_reserves: 115_000_000_000,
  virtual_token_reserves: 279_000_000_000_000,
  real_sol_reserves: 85_000_000_000,
  complete: true,
  usd_market_cap: 61_000,
};

/** A token account read with a live mint authority and a transfer hook. */
export const RISKY_ACCOUNT: unknown = {
  value: {
    data: {
      parsed: {
        info: {
          mintAuthority: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
          freezeAuthority: null,
          isMutable: true,
          extensions: {
            transferHook: { authority: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' },
          },
        },
      },
    },
  },
};

/** A clean account: both authorities revoked, no transfer extensions. */
export const SAFE_ACCOUNT: unknown = {
  value: {
    data: {
      parsed: {
        info: {
          mintAuthority: null,
          freezeAuthority: null,
          isMutable: true,
          extensions: {},
        },
      },
    },
  },
};

/** The account read failed. Nothing may be concluded from it. */
export const UNREADABLE_ACCOUNT: unknown = { value: null };
