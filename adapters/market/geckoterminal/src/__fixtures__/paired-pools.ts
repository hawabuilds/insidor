/**
 * GeckoTerminal's pools for Laura (Cg9z...pump), recorded 2026-10-21 with
 * `include=base_token,quote_token,dex` and trimmed to three: its PumpSwap pool against MSTRx (the
 * MicroStrategy xStock), one Meteora pool against SOL, and a pump-fun curve where Laura is the QUOTE
 * side of another coin. The included tokens and dexes are the ones those three name.
 */

export const LAURA_MINT = 'Cg9zDsrNUzkm7cUgrXyv5TaKpbH5dpnr4E7pFAZYpump';
export const MSTRX_MINT = 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ';

export const PAIRED_POOLS = {
  "data": [
    {
      "id": "solana_Fv44ZP4nZa45cT7Vv2UaQ8o5jNdrZzjuE3jvT1jPYVDK",
      "type": "pool",
      "attributes": {
        "address": "Fv44ZP4nZa45cT7Vv2UaQ8o5jNdrZzjuE3jvT1jPYVDK",
        "name": "Laura / MSTRx",
        "reserve_in_usd": "17471.8487"
      },
      "relationships": {
        "base_token": {
          "data": {
            "id": "solana_Cg9zDsrNUzkm7cUgrXyv5TaKpbH5dpnr4E7pFAZYpump",
            "type": "token"
          }
        },
        "quote_token": {
          "data": {
            "id": "solana_XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",
            "type": "token"
          }
        },
        "dex": {
          "data": {
            "id": "pumpswap",
            "type": "dex"
          }
        }
      }
    },
    {
      "id": "solana_CzHcK3WcJouENvGhhFmaVXUEgVVBHg7JyZ8JaNP5Lp7a",
      "type": "pool",
      "attributes": {
        "address": "CzHcK3WcJouENvGhhFmaVXUEgVVBHg7JyZ8JaNP5Lp7a",
        "name": "Laura / SOL",
        "reserve_in_usd": "195.7142"
      },
      "relationships": {
        "base_token": {
          "data": {
            "id": "solana_Cg9zDsrNUzkm7cUgrXyv5TaKpbH5dpnr4E7pFAZYpump",
            "type": "token"
          }
        },
        "quote_token": {
          "data": {
            "id": "solana_So11111111111111111111111111111111111111112",
            "type": "token"
          }
        },
        "dex": {
          "data": {
            "id": "meteora",
            "type": "dex"
          }
        }
      }
    },
    {
      "id": "solana_4Kv7FRJE3yXKeVRerygPXuwNERQiQKAYFAUZi9xM5XFU",
      "type": "pool",
      "attributes": {
        "address": "4Kv7FRJE3yXKeVRerygPXuwNERQiQKAYFAUZi9xM5XFU",
        "name": "LAURACAT / Laura",
        "reserve_in_usd": "481.5667"
      },
      "relationships": {
        "base_token": {
          "data": {
            "id": "solana_BDVGXm8bcAEi6K2BGA1pUfj5gL4BQ7tJMNLYBu26pump",
            "type": "token"
          }
        },
        "quote_token": {
          "data": {
            "id": "solana_Cg9zDsrNUzkm7cUgrXyv5TaKpbH5dpnr4E7pFAZYpump",
            "type": "token"
          }
        },
        "dex": {
          "data": {
            "id": "pump-fun",
            "type": "dex"
          }
        }
      }
    }
  ],
  "included": [
    {
      "id": "solana_Cg9zDsrNUzkm7cUgrXyv5TaKpbH5dpnr4E7pFAZYpump",
      "type": "token",
      "attributes": {
        "address": "Cg9zDsrNUzkm7cUgrXyv5TaKpbH5dpnr4E7pFAZYpump",
        "name": "Forever Laura",
        "symbol": "Laura",
        "image_url": "https://assets.geckoterminal.com/z56hc51kz1u7tn6haknkm3erl4uk"
      }
    },
    {
      "id": "solana_XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",
      "type": "token",
      "attributes": {
        "address": "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",
        "name": "MicroStrategy xStock",
        "symbol": "MSTRx",
        "image_url": "https://coin-images.coingecko.com/coins/images/55631/large/Ticker_MSTR__Company_Name_MicroStrategy__size_200x200_2x.png?1746862528"
      }
    },
    {
      "id": "pumpswap",
      "type": "dex",
      "attributes": {
        "name": "PumpSwap"
      }
    },
    {
      "id": "solana_So11111111111111111111111111111111111111112",
      "type": "token",
      "attributes": {
        "address": "So11111111111111111111111111111111111111112",
        "name": "Wrapped SOL",
        "symbol": "SOL",
        "image_url": "https://coin-images.coingecko.com/coins/images/21629/large/solana.jpg?1696520989"
      }
    },
    {
      "id": "meteora",
      "type": "dex",
      "attributes": {
        "name": "Meteora"
      }
    },
    {
      "id": "pump-fun",
      "type": "dex",
      "attributes": {
        "name": "Pump.fun"
      }
    },
    {
      "id": "solana_BDVGXm8bcAEi6K2BGA1pUfj5gL4BQ7tJMNLYBu26pump",
      "type": "token",
      "attributes": {
        "address": "BDVGXm8bcAEi6K2BGA1pUfj5gL4BQ7tJMNLYBu26pump",
        "name": "Laura cat",
        "symbol": "LAURACAT",
        "image_url": "https://assets.geckoterminal.com/cuxrsg6f5bkeirvbrrb0agngzqju"
      }
    }
  ]
};
