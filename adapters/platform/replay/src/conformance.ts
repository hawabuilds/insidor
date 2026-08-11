/**
 * What this package hands the shared conformance suite.
 *
 * The samples are recorded Items rather than vendor payloads, because for this
 * source the recording IS the payload. That difference is exactly what the
 * suite should be run against: if the contract only holds for inputs shaped
 * like one vendor's JSON, it is not a contract.
 */

import { RAW_TAPE } from './__fixtures__/tape.ts';
import { decodeTape } from './tape.ts';

const TAPE_LOADED_AT = 1_785_912_100_000;

export const tape = decodeTape(RAW_TAPE, TAPE_LOADED_AT);

export const conformance = {
  source: tape.source,
  samples: (RAW_TAPE as { readonly items: readonly unknown[] }).items,
};
