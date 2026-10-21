/**
 * The same recorded batch token reply as tokens.ts (2026-10-12), with the price fields kept: the
 * price in dollars and in SOL, the change over 1, 6 and 24 hours (the curve coin has no 1-hour
 * change in this reply), and the pool's liquidity. Each pair's quote token is wrapped SOL.
 *
 * LAURA_REPLY (2026-10-21) is a coin whose only pool is quoted in another coin (MSTRx, a stock
 * token), with that coin's own pool in the same batch: the source gives the pair no dollar price,
 * and its "native" price is in MSTRx, not SOL.
 */
export const QUOTES_REPLY = [
 {
  "chainId": "solana",
  "dexId": "pumpswap",
  "pairAddress": "2pdKkSuzEmgweKaP1rhhxqX9TQCyC65dSb58u6sHFEbh",
  "baseToken": {
   "address": "Bm4Czuq3X7BwgU429GiLb8wTHLNBiCzcysN8Gsqpump",
   "name": "Aura Bird",
   "symbol": "Stork"
  },
  "quoteToken": {
   "address": "So11111111111111111111111111111111111111112",
   "name": "Wrapped SOL",
   "symbol": "SOL"
  },
  "priceUsd": "0.000004841",
  "priceNative": "0.00000004447",
  "priceChange": {
   "h1": -0.11,
   "h6": -0.11,
   "h24": -0.11
  },
  "liquidity": {
   "usd": 5346.74,
   "base": 745138563,
   "quote": 15.9754
  },
  "marketCap": 4648,
  "fdv": 4648
 },
 {
  "chainId": "solana",
  "dexId": "pumpfun",
  "pairAddress": "DxfqqizEMTRbQpJ3A49oCFNJFcoAzFnxaAN7QiJMziKP",
  "baseToken": {
   "address": "szicVgykSZSQHvtuxxjQ9FsSorr2YPwcVVxYj5dMNAP",
   "name": "Nap Protocol",
   "symbol": "$NAPS"
  },
  "quoteToken": {
   "address": "So11111111111111111111111111111111111111112",
   "name": "Wrapped SOL",
   "symbol": "SOL"
  },
  "priceUsd": "0.000004387",
  "priceNative": "0.00000003974",
  "priceChange": {
   "h6": 13.44,
   "h24": -2.06
  },
  "marketCap": 4387.53,
  "fdv": 4387.53
 }
];

export const LAURA = 'Cg9zDsrNUzkm7cUgrXyv5TaKpbH5dpnr4E7pFAZYpump';
export const MSTRX = 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ';
export const LAURA_REPLY = [
 {
  "chainId": "solana",
  "dexId": "pumpswap",
  "pairAddress": "Fv44ZP4nZa45cT7Vv2UaQ8o5jNdrZzjuE3jvT1jPYVDK",
  "baseToken": { "address": "Cg9zDsrNUzkm7cUgrXyv5TaKpbH5dpnr4E7pFAZYpump", "name": "Forever Laura", "symbol": "Laura" },
  "quoteToken": { "address": "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", "name": "MicroStrategy xStock", "symbol": "MSTRx" },
  "priceNative": "0.0000002712",
  "priceChange": { "h1": 15.6, "h6": -11.9, "h24": -87.1 },
  "pairCreatedAt": 1792498067000
 },
 {
  "chainId": "solana",
  "dexId": "raydium",
  "pairAddress": "RyhF4cksVZY7vcqJpoytHcxcGNKRp27PEGhSnEPpbGv",
  "baseToken": { "address": "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", "name": "MicroStrategy xStock", "symbol": "MSTRx" },
  "quoteToken": { "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "name": "USD Coin", "symbol": "USDC" },
  "priceUsd": "146.61",
  "priceNative": "146.6143",
  "priceChange": { "h1": 0.1, "h6": 0.4, "h24": 1.2 },
  "liquidity": { "usd": 812444.4 },
  "pairCreatedAt": 1750000000000
 }
];
