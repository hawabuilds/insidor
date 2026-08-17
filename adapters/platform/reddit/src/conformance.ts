/**
 * What this package hands the shared conformance suite.
 *
 * It is a plain object rather than a typed import from the suite, because the
 * suite imports every adapter and an adapter that imported the suite back would
 * be a cycle. The suite types this structurally at the point of use.
 */

import { SAMPLES } from './__fixtures__/posts.ts';
import { SOURCE } from './capabilities.ts';

export const conformance = {
  source: SOURCE,
  samples: SAMPLES,
};
