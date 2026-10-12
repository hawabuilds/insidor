/**
 * The same recorded batch token reply as tokens.ts (2026-10-12), with the price fields kept: the
 * price in dollars and in SOL, the change over 1, 6 and 24 hours (the curve coin has no 1-hour
 * change in this reply), and the pool's liquidity.
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
