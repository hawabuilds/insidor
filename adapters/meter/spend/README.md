# @insidor/meter

One wrapper. Every vendor call in `adapters/` goes through `metered()`, so spend is measured
rather than estimated and a daily cap can actually refuse a call.

```ts
const read = await metered(meter, PRICES, { vendor, endpoint, unit, estUnits, at }, async () => {
  const res = await client.search(q);          // the only network line
  return { value: res.items, units: res.items.length };
});
read.value;  // what came back
read.spend;  // what it cost — travels with the value, all the way to the decision
```

## What breaks here

- **A price with no `measuredAt`.** Stale rates are the failure mode with history: a call priced
  at $0.003 against a measured $0.00127 paused work at a third of affordable throughput.
- **A `record()` that only runs on success.** That is the live bug this replaces — calls billed by
  the vendor and never counted by us, concentrated on the error path. Both paths settle here, once.
- **A default cap or soft stop appearing in `InMemoryMeterOptions`.** Both are thresholds. They
  come from policy, through services, as arguments.
- **Anyone adding a retry or a cache here.** Both change what the vendor was asked; this module
  exists to report what was asked.
