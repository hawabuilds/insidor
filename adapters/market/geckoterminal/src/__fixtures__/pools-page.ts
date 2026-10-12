/**
 * The first page of PumpSwap's pools by 24-hour volume, recorded 2026-10-12, trimmed to three pools
 * and the fields read. Real pools, real numbers.
 */
export const PUMPSWAP_POOLS = {
  "data": [
    {
      "id": "solana_FRvYyNTGzQRQfsbDZntcqQwHJpmHZKtMh7N85uDG1i4H",
      "type": "pool",
      "attributes": {
        "address": "FRvYyNTGzQRQfsbDZntcqQwHJpmHZKtMh7N85uDG1i4H",
        "name": "PULT / SOL",
        "pool_created_at": "2026-10-12T00:24:22Z",
        "market_cap_usd": null,
        "fdv_usd": "3174474.537",
        "base_token_price_usd": "0.0000315427493881876903699813801288805723981444646292610511998340552"
      },
      "relationships": {
        "base_token": {
          "data": {
            "id": "solana_69ZhASRy7GKVd1XN5MdpvmMbmkQ7AKTpKzDbiqUbNM1B",
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
      "id": "solana_D3vzKTEJntE3wSu4QaPd79e2bnifnHggVDVewu1ukkAJ",
      "type": "pool",
      "attributes": {
        "address": "D3vzKTEJntE3wSu4QaPd79e2bnifnHggVDVewu1ukkAJ",
        "name": "RSGP / SOL",
        "pool_created_at": "2026-10-12T00:24:43Z",
        "market_cap_usd": null,
        "fdv_usd": "3035989.346",
        "base_token_price_usd": "0.0000303598934583491225860602136762600802653595009628233253358740365"
      },
      "relationships": {
        "base_token": {
          "data": {
            "id": "solana_6TCLXY3Yxb2N5428Abmo9Af7c3DQYnSbkBwKMWcjk9tF",
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
      "id": "solana_6KCmCfW5GSf7nQ7hfk8ds2aTiZXUYLcKAsmH3ZLZW6p3",
      "type": "pool",
      "attributes": {
        "address": "6KCmCfW5GSf7nQ7hfk8ds2aTiZXUYLcKAsmH3ZLZW6p3",
        "name": "ALLOX / SOL",
        "pool_created_at": "2026-10-12T00:19:23Z",
        "market_cap_usd": null,
        "fdv_usd": "3058891.914",
        "base_token_price_usd": "0.0000305889191436874185499048580077978682419434362292303267394291124"
      },
      "relationships": {
        "base_token": {
          "data": {
            "id": "solana_FPTfWkiT8uxEbZsrTUzepN8GXnxt4d8BENxbxWihAcus",
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
    }
  ]
};
