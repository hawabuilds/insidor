# @insidor/platform-tiktok

The proof the abstraction works. This source has no reproduction concept, declares that concept
absent, and emits no counter for it — which is the case the port was designed around.

Read `src/capabilities.ts` first. It is mostly comment, and the comment is the point.

## What breaks here

- **`reproduction: 0`.** The build this replaces hardcoded exactly that for every post from this
  source, and reproduction is the signal the product sells. Zero reads downstream as "nobody
  copied this". There is a test that fails if the key so much as appears.
- **Mapping share count into reproduction to "fill the gap".** A share creates no new authored
  object. Stitch and duet do. That is why one is a counter and the other is a pointer.
- **Pricing a run per item.** This vendor bills per actor run; a run that returns nothing still
  costs. The meter refuses a per-item price for a per-run call.
- **Returning an empty array for a keyword query.** There is no keyword search here, and an empty
  result reads as "nothing is happening" — the exact failure the capability list exists to prevent.
