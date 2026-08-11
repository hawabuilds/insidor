/** What this package hands the shared conformance suite. See x/src/conformance.ts. */

import { SAMPLES } from './__fixtures__/posts.ts';
import { SOURCE } from './capabilities.ts';

export const conformance = {
  source: SOURCE,
  samples: SAMPLES,
};
