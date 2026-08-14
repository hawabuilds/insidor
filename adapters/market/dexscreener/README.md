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
- **Keeping the pairs in which our token is the QUOTE side.** Both token endpoints return every
  pair the address appears in. Measured 14 August 2026: 7 of 30 pairs returned for one token were
  pairs it quotes, and in those rows `priceUsd`, `fdv` and `marketCap` describe the *other* token.
  Left in, they are ranked for depth beside the real ones, so a token whose deepest pool is one it
  quotes gets published at a different coin's price and market cap — and the row looks fine. The
  client keeps only pairs whose `baseToken.address` is one we asked about.
- **Handing the vendor's bare array straight to `toMarketState`.** Both endpoints answer with a
  top-level JSON array; the mapper reads `{ pairs: [...] }`, and `rec()` of an array is `{}` by
  design. Unnormalised, every coin would read as `no_market` with no error anywhere. The client
  normalises, once.
- **Trusting a chain slug.** This vendor answers `200 []` for a chain it has never heard of, so an
  unchecked slug reads as "nothing here has a market", quietly, for as long as it takes someone to
  notice. `pairsForToken`/`pairsForTokens` throw on anything but `solana`.
- **Reading an HTTP failure as an empty market.** "No such token" is `200 []`; a 404, a 429, or a
  200 carrying a CDN challenge page are outages, and they throw `VendorUnavailable` with the status
  attached. A body that parses as JSON but is not a list throws `VendorShapeError` instead — an
  outage and a schema change are different incidents and must not arrive as the same error.
