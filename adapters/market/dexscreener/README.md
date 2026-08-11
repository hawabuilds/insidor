# @insidor/market-dexscreener

Price and pool reads, exposed as a read-only venue.

## What breaks here

- **`Number(pair.liquidity?.usd) || 0`.** That expression, in the build this replaces, collapsed
  "this venue has no reserve concept" and "this pool was drained" into one value, and two call
  sites then rejected both. It removed the entire pre-graduation population. There is a fixture
  for each case and a test that asserts they differ.
- **A `searchBySymbol` method.** Symbol is not a retrieval key — one meme's symbol returns
  hundreds of tokens — and the endpoint rate-limits after about eleven sequential calls.
- **Ranking pairs by 24-hour volume.** That is what kept an established survivor ahead of a fresh
  curve even after the liquidity gate came out.
- **Using `pairCreatedAt` as a mint time.** Median +22 minutes against the launchpad's own record,
  with a tail into thousands of hours. It is carried with confidence `'unknown'` and nothing
  gates on it.
