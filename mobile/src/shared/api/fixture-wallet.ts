/**
 * A SAMPLE WALLET for builds with no read service: the read service's real reply for a public
 * wallet (86xCnPeV…), recorded 2026-10-12 and cut to its ten largest holdings. Every screen that
 * shows it says "Sample data". Real balances and real market prices at that moment; nothing here
 * is the person's own wallet, and the prices are a day stale by the time anyone sees them.
 */
export function fixturePortfolio(): unknown {
  return SAMPLE;
}

const SAMPLE = {
 "kind": "read",
 "address": "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY",
 "range": "24h",
 "solBalance": {
  "v": 1328.465917638
 },
 "totalUsd": {
  "v": 1361658.7443380516
 },
 "totalSol": {
  "v": 12640.723582789193
 },
 "holdings": [
  {
   "coinId": "solana:AT79ReYU9XtHUTF5vM6Q4oa9K8w7918Fp5SU7G1MDMQY",
   "address": "AT79ReYU9XtHUTF5vM6Q4oa9K8w7918Fp5SU7G1MDMQY",
   "ticker": "SPDR",
   "name": "SpiderSwap",
   "imageUrl": "https://arweave.net/PAVQPYRQzq2g4O2X7hDzOniW4aBE9PJ19U56MRVpIfA",
   "amount": "500000000000000000",
   "decimals": 9,
   "valueUsd": {
    "v": 1213500
   },
   "change": {
    "v": -2.9
   },
   "profit": {
    "kind": "none",
    "why": "no_buy_history"
   },
   "story": null
  },
  {
   "coinId": "solana:5JEdwCUafTGLFZz8wDLmWNLbJKKwFafrHJ7A3W1Wpump",
   "address": "5JEdwCUafTGLFZz8wDLmWNLbJKKwFafrHJ7A3W1Wpump",
   "ticker": "GREENLAND",
   "name": "America 51st State",
   "imageUrl": "https://ipfs.io/ipfs/QmePNo8YNbyury8QD77XUuyqnS6ah8RpA8Z89xbc7Xuq7W",
   "amount": "133700000000000",
   "decimals": 6,
   "valueUsd": {
    "v": 2708.7619999999997
   },
   "change": {
    "v": null,
    "why": "not_reported"
   },
   "profit": {
    "kind": "none",
    "why": "no_buy_history"
   },
   "story": null
  },
  {
   "coinId": "solana:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
   "address": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
   "ticker": "Bonk",
   "name": "Bonk",
   "imageUrl": "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I",
   "amount": "39758697055337",
   "decimals": 5,
   "valueUsd": {
    "v": 1310.4466549439076
   },
   "change": {
    "v": -5.39
   },
   "profit": {
    "kind": "none",
    "why": "no_buy_history"
   },
   "story": null
  },
  {
   "coinId": "solana:6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx",
   "address": "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx",
   "ticker": "STONK",
   "name": "STONK",
   "imageUrl": "https://gateway.irys.xyz/em5twmyoeTJw9eZDj25xoKbBjHYhbeXYCcZ55o23Ztg",
   "amount": "4839277530301",
   "decimals": 9,
   "valueUsd": {
    "v": 691.0488313269828
   },
   "change": {
    "v": -3.44
   },
   "profit": {
    "kind": "none",
    "why": "no_buy_history"
   },
   "story": null
  },
  {
   "coinId": "solana:BPxxfRCXkUVhig4HS1Lh7kZqV6SPJhzfEk4x6fVBjPCy",
   "address": "BPxxfRCXkUVhig4HS1Lh7kZqV6SPJhzfEk4x6fVBjPCy",
   "ticker": "BP",
   "name": "Backpack",
   "imageUrl": "https://trek-labs.github.io/heart-metadata/bp/bp.png",
   "amount": "175350865891",
   "decimals": 9,
   "valueUsd": {
    "v": 194.63946113901002
   },
   "change": {
    "v": -5.81
   },
   "profit": {
    "kind": "none",
    "why": "no_buy_history"
   },
   "story": null
  },
  {
   "coinId": "solana:HmwZ7aL6GtQZBAd7w9mSJMVy5fRU9ra57c6bnuPCinvD",
   "address": "HmwZ7aL6GtQZBAd7w9mSJMVy5fRU9ra57c6bnuPCinvD",
   "ticker": "$PIE",
   "name": "Toly's Pumpkin Pie",
   "imageUrl": "https://media.discordapp.net/attachments/962288267292717106/1177718882065186817/INCOME_SOCIETY_8.png?ex=6573872e&is=6561122e&hm=f21817c2eef895f9d1120185504712a0a035f94fed090ed70e542896daea2e55&=&width=810&height=810",
   "amount": "400000000",
   "decimals": 3,
   "valueUsd": {
    "v": 58.32
   },
   "change": {
    "v": -0.32
   },
   "profit": {
    "kind": "none",
    "why": "no_buy_history"
   },
   "story": null
  },
  {
   "coinId": "solana:Ho6wN4ff7RdTdXE1UsCZjrjuFVMHyRFTv1oBdbSECnJS",
   "address": "Ho6wN4ff7RdTdXE1UsCZjrjuFVMHyRFTv1oBdbSECnJS",
   "ticker": "SEAL",
   "name": "SEAL",
   "imageUrl": "https://gateway.irys.xyz/EU38d9igPQKzFfXjbZvm53FjgE5E9GENtkDcFPsoVMMD",
   "amount": "1000000000000",
   "decimals": 6,
   "valueUsd": {
    "v": 30.929999999999996
   },
   "change": {
    "v": -3.18
   },
   "profit": {
    "kind": "none",
    "why": "no_buy_history"
   },
   "story": null
  },
  {
   "coinId": "solana:5314GTpDziP2ZdaANnt5KJEABGXy5Nn5Kyc3SFPYpump",
   "address": "5314GTpDziP2ZdaANnt5KJEABGXy5Nn5Kyc3SFPYpump",
   "ticker": "TOUCHGRASS",
   "name": "Touch Grass",
   "imageUrl": "https://ipfs.io/ipfs/bafybeieo7rpbjawus2ditvgzoswrbeyvtjp5mieio627d3t7rr52sjgapm",
   "amount": "50000000000",
   "decimals": 6,
   "valueUsd": {
    "v": 22.939999999999998
   },
   "change": {
    "v": -1.57
   },
   "profit": {
    "kind": "none",
    "why": "no_buy_history"
   },
   "story": null
  },
  {
   "coinId": "solana:GN3Njbg9dP13pBX2MvdXurr4cuxzVmsVtKwnhPPymWZh",
   "address": "GN3Njbg9dP13pBX2MvdXurr4cuxzVmsVtKwnhPPymWZh",
   "ticker": "cUAH",
   "name": "Cyclos Hryvnia",
   "imageUrl": "https://ipfs.io/ipfs/bafkreibrykfs3naeq6dmtopfr62vioe6notchkhrov2nxnfn6w2i2eubg4",
   "amount": "10000000",
   "decimals": 4,
   "valueUsd": {
    "v": 22.270000000000003
   },
   "change": {
    "v": 0.74
   },
   "profit": {
    "kind": "none",
    "why": "no_buy_history"
   },
   "story": null
  },
  {
   "coinId": "solana:M3M3pSFptfpZYnWNUgAbyWzKKgPo5d1eWmX6tbiSF2K",
   "address": "M3M3pSFptfpZYnWNUgAbyWzKKgPo5d1eWmX6tbiSF2K",
   "ticker": "M3M3",
   "name": "M3M3",
   "imageUrl": "https://gateway.pinata.cloud/ipfs/bafkreibfu4mivnd2w7khp35m6g2gpe7lzruiv52v2xs3m3vxh76ildqcye",
   "amount": "39538000000000",
   "decimals": 9,
   "valueUsd": {
    "v": 4.2977806
   },
   "change": {
    "v": -2.09
   },
   "profit": {
    "kind": "none",
    "why": "no_buy_history"
   },
   "story": null
  }
 ],
 "notShown": 1080,
 "unpriced": 1056,
 "historyDepth": 200,
 "created": {
  "unclaimedFeesSol": {
   "v": null,
   "why": "not_reported"
  },
  "coins": []
 }
};
