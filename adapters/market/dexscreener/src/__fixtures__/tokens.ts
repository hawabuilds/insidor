/**
 * One batch token reply, recorded 2026-10-12 for three addresses: a coin that bonded (its pool on
 * PumpSwap), a coin still on its curve, and a coin the source does not list (asked for, absent).
 * Trimmed to the fields read; real addresses and real numbers.
 */
export const ASKED = ['Bm4Czuq3X7BwgU429GiLb8wTHLNBiCzcysN8Gsqpump', 'szicVgykSZSQHvtuxxjQ9FsSorr2YPwcVVxYj5dMNAP', 'HHDRWwYw6FXFAaLMJ9XsUJ5NhMJHVNoEECTkkfpapump'] as const;

export const TOKENS_REPLY = [
  {
    "chainId": "solana",
    "dexId": "pumpswap",
    "pairAddress": "2pdKkSuzEmgweKaP1rhhxqX9TQCyC65dSb58u6sHFEbh",
    "baseToken": {
      "address": "Bm4Czuq3X7BwgU429GiLb8wTHLNBiCzcysN8Gsqpump",
      "name": "Aura Bird",
      "symbol": "Stork"
    },
    "marketCap": 4648,
    "fdv": 4648,
    "pairCreatedAt": 1784765083000
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
    "marketCap": 4387.53,
    "fdv": 4387.53,
    "pairCreatedAt": 1791704002000
  }
];
