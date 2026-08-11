# @insidor/adapter-conformance

One suite, run against every platform adapter and every venue adapter. It is what makes the
abstraction real rather than aspirational.

Two tests carry most of the weight:

- **A platform never emits a counter it declared absent** — not null, not zero, not present. That
  is the defect this rebuild exists to remove.
- **A bonding-curve venue never reports a liquidity number** — absence and zero stay different
  facts, and only one of them means "this market is empty".

## Adding a source

One line in `adapters/platform/registry`, one line in `src/all.test.ts`. The first test in that
file fails if you do the first without the second, because a source with no recorded payload is a
source whose translation nobody has ever checked.

## What breaks here

- **A client in `stubs.ts` that does not throw.** Everything this suite tests must hold before any
  request is made; needing a live response means the thing under test has leaked into the network
  half of the adapter.
- **A vendor field name appearing in `platform.contract.ts`.** Every assertion here is in our
  vocabulary — that is why one file can run against a source with a reproduction count, a source
  with none, and a JSON file.
