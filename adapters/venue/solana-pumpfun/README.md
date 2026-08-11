# @insidor/venue-solana-pumpfun

A bonding-curve venue: watch new mints, read market state, assess safety, quote a trade.

A venue is a market on a chain, and it is the unit of variation. This venue differs from an AMM on
the same chain more than that AMM differs from one on another chain, which is why "the Solana
adapter" is the wrong shape.

## What breaks here

- **A number in `liquidityUsd`.** A curve has no two-sided reserve; the vendors return no
  liquidity object at all. Reading that absence as zero is what turned a quality filter into a
  survivorship filter and removed the entire pre-graduation population.
- **A mint time claiming `'exact'` from one source.** Two independent sources have to agree. The measured
  failure is not a missing timestamp, it is a confident wrong one — median +22 minutes against a
  3.8-minute post-to-mint gap, which reverses the ordering gate silently.
- **Treating `symbol` as an identifier.** One meme's symbol returned 306 tokens. Symbol is a
  scoring channel, never a retrieval key.
- **A required safety check that this venue cannot answer.** It renders as unknown forever and
  suppresses Buy for a reason that does not apply. `requiredChecks` is per venue for that reason.
- **Caching a route.** The route changes at graduation, and a cached one sends the trade to a venue
  the coin has left.
