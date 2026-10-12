/**
 * A keyless Jupiter quote, recorded 2026-10-12: 0.01 SOL into Stork, a coin that bonded, routed
 * through the launchpad's pool. Verbatim, so the test can check the build sends it back unchanged.
 */
export const BONDED_QUOTE = {
 "inputMint": "So11111111111111111111111111111111111111112",
 "inAmount": "10000000",
 "outputMint": "Bm4Czuq3X7BwgU429GiLb8wTHLNBiCzcysN8Gsqpump",
 "outAmount": "219226227870",
 "otherAmountThreshold": "212649441034",
 "swapMode": "ExactIn",
 "slippageBps": 300,
 "platformFee": null,
 "priceImpactPct": "0.0192390724945756483826729605",
 "routePlan": [
  {
   "swapInfo": {
    "ammKey": "2pdKkSuzEmgweKaP1rhhxqX9TQCyC65dSb58u6sHFEbh",
    "label": "Pump.fun Amm",
    "inputMint": "So11111111111111111111111111111111111111112",
    "outputMint": "Bm4Czuq3X7BwgU429GiLb8wTHLNBiCzcysN8Gsqpump",
    "inAmount": "10000000",
    "outAmount": "219226227870",
    "updateContextSlot": "456118857"
   },
   "percent": 100,
   "bps": null
  }
 ],
 "contextSlot": 456118857,
 "timeTaken": 0.000179788,
 "swapUsdValue": "1.083005073495242",
 "mostReliableAmmsQuoteReport": {
  "info": {
   "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE": "Not used RG: FullLiquidIntermediate, contains ALT: true",
   "2pdKkSuzEmgweKaP1rhhxqX9TQCyC65dSb58u6sHFEbh": "219226227870"
  }
 },
 "longtailMarketQuoteReport": null,
 "useIncurredSlippageForQuoting": null,
 "useRewards": null,
 "otherRoutePlans": null,
 "loadedLongtailToken": false,
 "instructionVersion": null,
 "transactionVersion": 0
};
