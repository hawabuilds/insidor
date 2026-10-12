/**
 * GeckoTerminal replies, recorded 2026-10-12 from the public API and trimmed: the pools for one
 * graduated coin (its old pump-fun curve pool, its PumpSwap pool, one Meteora pool), five
 * 5-minute candles for that coin, and four trades from a coin still on its curve.
 */

export const GRADUATED_MINT = 'Bm4Czuq3X7BwgU429GiLb8wTHLNBiCzcysN8Gsqpump';
export const CURVE_MINT = "szicVgykSZSQHvtuxxjQ9FsSorr2YPwcVVxYj5dMNAP";
export const CURVE_POOL = "DxfqqizEMTRbQpJ3A49oCFNJFcoAzFnxaAN7QiJMziKP";

export const POOLS = {
  "data": [
    {
      "id": "solana_AeJyitRgt3ZRqC84tpiwZPTTPjSJjX8pS4nbjtvNH4Ep",
      "type": "pool",
      "attributes": {
        "address": "AeJyitRgt3ZRqC84tpiwZPTTPjSJjX8pS4nbjtvNH4Ep",
        "name": "Stork / SOL",
        "reserve_in_usd": "0.0",
        "base_token_price_usd": "0.00001932088769"
      },
      "relationships": {
        "base_token": {
          "data": {
            "id": "solana_Bm4Czuq3X7BwgU429GiLb8wTHLNBiCzcysN8Gsqpump",
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
            "id": "pump-fun",
            "type": "dex"
          }
        }
      }
    },
    {
      "id": "solana_2pdKkSuzEmgweKaP1rhhxqX9TQCyC65dSb58u6sHFEbh",
      "type": "pool",
      "attributes": {
        "address": "2pdKkSuzEmgweKaP1rhhxqX9TQCyC65dSb58u6sHFEbh",
        "name": "Stork / SOL",
        "reserve_in_usd": "5390.1728",
        "base_token_price_usd": "0.000004862102271"
      },
      "relationships": {
        "base_token": {
          "data": {
            "id": "solana_Bm4Czuq3X7BwgU429GiLb8wTHLNBiCzcysN8Gsqpump",
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
            "id": "pumpswap",
            "type": "dex"
          }
        }
      }
    },
    {
      "id": "solana_FHdaHYjf9JDhHjAZdr6b5WJugii8tFKcDyLSdnE9FZjG",
      "type": "pool",
      "attributes": {
        "address": "FHdaHYjf9JDhHjAZdr6b5WJugii8tFKcDyLSdnE9FZjG",
        "name": "Stork / SOL",
        "reserve_in_usd": "3391.2043",
        "base_token_price_usd": "0.00002707479235"
      },
      "relationships": {
        "base_token": {
          "data": {
            "id": "solana_Bm4Czuq3X7BwgU429GiLb8wTHLNBiCzcysN8Gsqpump",
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
    }
  ]
};

export const OHLCV_5M = {
  "data": {
    "attributes": {
      "ohlcv_list": [
        [
          1791709500,
          0.000004963629863572491,
          0.000004963629863572491,
          0.00000486210227086438,
          0.00000486210227086438,
          1.3858128097426252
        ],
        [
          1791657300,
          0.0000048896912646070825,
          0.000004963629863572491,
          0.0000048896912646070825,
          0.000004963629863572491,
          0.4895813798222413
        ],
        [
          1791642000,
          0.000005174212879155192,
          0.000005174212879155192,
          0.0000048896912646070825,
          0.0000048896912646070825,
          0.22912903353762853
        ],
        [
          1791378000,
          0.00000523877634965541,
          0.00000523877634965541,
          0.000005174212879155192,
          0.000005174212879155192,
          0.06864771395693295
        ],
        [
          1791339000,
          0.00000523877634965541,
          0.00000523877634965541,
          0.00000523877634965541,
          0.00000523877634965541,
          1.8901700675564326
        ]
      ]
    }
  },
  "meta": {
    "base": {
      "name": "Aura Bird",
      "symbol": "Stork",
      "coingecko_coin_id": null,
      "address": "Bm4Czuq3X7BwgU429GiLb8wTHLNBiCzcysN8Gsqpump"
    },
    "quote": {
      "name": "Wrapped SOL",
      "symbol": "SOL",
      "coingecko_coin_id": "wrapped-solana",
      "address": "So11111111111111111111111111111111111111112"
    }
  }
};

export const TRADES = {
  "data": [
    {
      "id": "solana_456052015_54RP8mGmQ9KTR8Vy1Kzhynh2vhUJF4wuCN3FFNwyigexKsixTV16EPUJqmNb18XYXc3pBzKEQwduxfJ4DtLTAdnc_20_1791809246",
      "type": "trade",
      "attributes": {
        "block_number": 456052015,
        "block_timestamp": "2026-10-12T12:47:18Z",
        "tx_hash": "54RP8mGmQ9KTR8Vy1Kzhynh2vhUJF4wuCN3FFNwyigexKsixTV16EPUJqmNb18XYXc3pBzKEQwduxfJ4DtLTAdnc",
        "tx_from_address": "4Uq2ZospruqYrqsPXHoYgqe6SpgVsU9goQeMR4k5E561",
        "kind": "sell",
        "from_token_address": "szicVgykSZSQHvtuxxjQ9FsSorr2YPwcVVxYj5dMNAP",
        "to_token_address": "So11111111111111111111111111111111111111112",
        "from_token_amount": "8.0",
        "to_token_amount": "0.000000318",
        "price_from_in_usd": "0.00000438521475615213858498769566044341656469932941090325",
        "price_to_in_usd": "110.319868079299083899061526048890982759731557507",
        "price_from_in_currency_token": "0.00000003975",
        "price_to_in_currency_token": "1.0",
        "volume_in_usd": "0.000035081718049217108679901565283547332517594635287226"
      }
    },
    {
      "id": "solana_456052015_237BLn3wgA5mBuyUJHY9ubw5swJKmg14zFJwVndEYCxgeiLhsVq4gbZguxFLm7NK3rzBWqeBYjPFqCbnvHjyR536_20_1791809246",
      "type": "trade",
      "attributes": {
        "block_number": 456052015,
        "block_timestamp": "2026-10-12T12:47:18Z",
        "tx_hash": "237BLn3wgA5mBuyUJHY9ubw5swJKmg14zFJwVndEYCxgeiLhsVq4gbZguxFLm7NK3rzBWqeBYjPFqCbnvHjyR536",
        "tx_from_address": "9naKoDsY6LjBzEcVL3efncEiax7LaXacVfFU5X9Lbsqd",
        "kind": "sell",
        "from_token_address": "szicVgykSZSQHvtuxxjQ9FsSorr2YPwcVVxYj5dMNAP",
        "to_token_address": "So11111111111111111111111111111111111111112",
        "from_token_amount": "21853.0",
        "to_token_amount": "0.000868663",
        "price_from_in_usd": "0.00000438524630784643632858333808035798986627954374062410787431942851",
        "price_to_in_usd": "110.319868079299083899061526048890982759731557507",
        "price_from_in_currency_token": "0.0000000397502860019219",
        "price_to_in_currency_token": "1.0",
        "volume_in_usd": "0.09583078756536817308853168707006315254780686936385862937750247122903"
      }
    },
    {
      "id": "solana_456052014_382q4dT8ZtkxaV2QJ9UPHnLhx48njPgcjejnzkuB4kukc7XWcT5CfjnCBjLSQw5kXqaEbusnUDSdk8FLygaA7s1S_20_1791809249",
      "type": "trade",
      "attributes": {
        "block_number": 456052014,
        "block_timestamp": "2026-10-12T12:47:18Z",
        "tx_hash": "382q4dT8ZtkxaV2QJ9UPHnLhx48njPgcjejnzkuB4kukc7XWcT5CfjnCBjLSQw5kXqaEbusnUDSdk8FLygaA7s1S",
        "tx_from_address": "EScvxoBGQQYLVE2Ao5mniQFgxZdXQxGmv2bUGCc2dGRa",
        "kind": "sell",
        "from_token_address": "szicVgykSZSQHvtuxxjQ9FsSorr2YPwcVVxYj5dMNAP",
        "to_token_address": "So11111111111111111111111111111111111111112",
        "from_token_amount": "67446.0",
        "to_token_amount": "0.002681265",
        "price_from_in_usd": "0.0000043866937856575794071715556523158307968375538492638478859544758",
        "price_to_in_usd": "110.34528443382548751560203095635187858302079009",
        "price_from_in_currency_token": "0.0000000397542478427186",
        "price_to_in_currency_token": "1.0",
        "volume_in_usd": "0.2958649490674611006960927425260935239235056569174494845160855748068"
      }
    },
    {
      "id": "solana_456052012_mT4qvB3Qfx6PEcbgGLbkf2gCXTNyqUuZjnt4tmqmeMnNcckWDt7the4SVYvciA5LD1de4NF8xCf1wVP2fEEbi14_20_1791809247",
      "type": "trade",
      "attributes": {
        "block_number": 456052012,
        "block_timestamp": "2026-10-12T12:47:17Z",
        "tx_hash": "mT4qvB3Qfx6PEcbgGLbkf2gCXTNyqUuZjnt4tmqmeMnNcckWDt7the4SVYvciA5LD1de4NF8xCf1wVP2fEEbi14",
        "tx_from_address": "786NMocZSG7wPdWFKqeGxYie4r1sfbeHmjSy323wG8Jt",
        "kind": "sell",
        "from_token_address": "szicVgykSZSQHvtuxxjQ9FsSorr2YPwcVVxYj5dMNAP",
        "to_token_address": "So11111111111111111111111111111111111111112",
        "from_token_amount": "27383.0",
        "to_token_amount": "0.001088743",
        "price_from_in_usd": "0.0000043863725984856456888034842803593281168245045301427289149487364",
        "price_to_in_usd": "110.32175716797484375367163291106584232099078428",
        "price_from_in_currency_token": "0.0000000397598144834386",
        "price_to_in_currency_token": "1.0",
        "volume_in_usd": "0.1201120408643324358965058100490794818230054075488983458780412488412"
      }
    }
  ]
};

