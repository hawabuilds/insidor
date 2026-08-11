# @insidor/platform-x

One source, translated. `capabilities.ts` says what it can do, `to-item.ts` is the only file
allowed to know its field names, `client.ts` is the only file that touches the network.

This is the source where `reproduction` is a first-class count readable from one snapshot. It is
the exception, not the model.

## What breaks here

- **Treating reach as exact.** It is rounded above a magnitude the vendor does not publish, so it
  is declared `quantized` for every reading and core derives the step from the value. Change that
  to `exact` and every large item starts emitting rate points that are rounding noise.
- **Filing a retweet as a reproduction.** A retweet creates no new authored object. Getting the
  two backwards inverts the signal the product sells.
- **An `if` that drops an item.** Filtering is a product decision; it belongs in `core/admit`.
- **A threshold arriving as a magnitude check in `FIDELITY`.** Numbers that decide things live in
  policy.
