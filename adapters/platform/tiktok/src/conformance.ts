/**
 * What this package hands the shared conformance suite.
 *
 * It is a plain object rather than a typed import from the suite, because the
 * suite imports every adapter and an adapter that imported the suite back would
 * be a cycle. The suite types this structurally at the point of use.
 *
 * ★ WHAT THESE PARTICULAR SAMPLES ARE FOR, AND WHY THEY ARE NOT INTERCHANGEABLE.
 * This source has no reproduction count — see `capabilities.ts` for why that is
 * a fact about the vendor rather than a gap in the adapter. The suite's sharpest
 * assertion, "never emits a counter it declared absent", is only as strong as
 * what it is run over: these payloads carry no field that could be read as a
 * reproduction count, so `absent: ['reproduction']` is backed by evidence and not
 * merely by agreement between two files we wrote. Replace them with samples that
 * do carry such a field and the assertion still passes — but it has stopped
 * demonstrating anything about the vendor, and the hardcoded zero that
 * `capabilities.ts` exists to prevent is one careless mapper away again.
 */

import { SAMPLES } from './__fixtures__/posts.ts';
import { SOURCE } from './capabilities.ts';

export const conformance = {
  source: SOURCE,
  samples: SAMPLES,
};
