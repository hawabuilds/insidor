# `eval/`

Offline evaluation. **Never touches the network** — that ban is enforced by
`.dependency-cruiser.cjs` (`eval` may not import `adapters`), not by convention,
because a replay that hits the network is not a replay.

| Question | Directory |
|---|---|
| What would this threshold change have done to the last 90 days? | `src/replay/` |
| Does the resolver still catch the four incidents that shipped? | `src/gold/` |
| How do we test a claim about the world without fooling ourselves? | `src/blind/` |

## replay

Re-runs the pure core over the decision log under a candidate policy and reports
which verdicts would flip.

This works because of three properties that look like taste until you try it
without them. The log froze the feature vector at the moment of the decision,
before the outcome existed — so the replay reads exactly what the decider saw and
does not recompute it. `decide()` is synchronous, so it cannot fetch, query or
call a hosted model; six months of decisions replay with no key and no vendor
being up. And every row carries its `policyHash`, so a before/after comparison is
not comparing two unknowables.

**The invariant to check before trusting any candidate run:** replay with the
*current* policy and confirm zero flips. A replay that disagrees with the log
about the past cannot be trusted about a hypothetical.

**The lane matters more than the sample size.** Only the holdout lane — uniform
over arrivals, bypassing every gate, tracked but never rendered — can answer
"what would a 5,000-view floor have caught?" The exploit lane cannot answer it at
any sample size, because it never saw what the gate rejected. `lane.ts` prints
the caveat under every number so a report cannot quietly overclaim.

## gold

The frozen regression set: real failures the previous build produced, so a
threshold change cannot silently reintroduce them.

- **"gym day" → $PUMP** — $1.84B, minted 375 days before the post
- **"stefan back on the grass" → $GRASS** — $225M, 633 days before
- **"gym day" → "Gym Showdown"** — 65 days before, $61k liquidity, and *nothing
  about it looks wrong*. The quiet plausible answer is the one that costs money.
- **$KANG** — a ticker the language model invented, which became canonical
- plus a **negative control**: a live bonding-curve token minted four minutes
  after the post, with no liquidity object at all, which the resolver must
  ACCEPT. A gold set of only rejections rewards a resolver that rejects
  everything.

Append-only. Add cases; never edit one to make a run go green.

## blind

The blind labelling protocol — see `src/blind/protocol.md`. Upgraded in two
places so the artefact can prove its own blindness rather than asking for it.

## Not here

The LightGBM parity fixture lives in `ml/serve/fixtures/` with its test, because
`eval` does not depend on `ml`. It is the same kind of artefact — a committed
oracle that fails CI on a silent divergence — and it is worth knowing it exists
when reading this directory.
