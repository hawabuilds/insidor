/**
 * What a formatter is allowed to return.
 *
 * Every formatter in this directory returns `Rendered`, never `string`. That is the second
 * half of the missing-data rule: the type makes it impossible to hand a component a bare
 * string whose provenance is forgotten, so a component cannot accidentally style an absence
 * as if it were a value. `kind` decides the treatment; `text` is only ever the glyph for the
 * pending branch, never a number.
 *
 * There is no path in this file that produces "0" from a pending input. The pending branch
 * does not receive the number, because there isn't one.
 */

import type { PendingReason } from './measure.ts';

export type Rendered =
  | { readonly kind: 'value'; readonly text: string }
  | { readonly kind: 'pending'; readonly text: string; readonly reason: PendingReason };

/** An em dash, not a zero and not an empty string. An empty cell reads as a layout bug. */
export const PENDING_GLYPH = '—';

export function value(text: string): Rendered {
  return { kind: 'value', text };
}

export function pendingRendered(reason: PendingReason): Rendered {
  return { kind: 'pending', text: PENDING_GLYPH, reason };
}

/**
 * The words shown on hover and to screen readers. Short, plain, and about the world rather
 * than about our pipeline — "no market yet" is a fact a user can act on; "qualify stage has
 * not run" is an internal state and would be a leak besides.
 */
export function pendingLabel(reason: PendingReason): string {
  switch (reason) {
    case 'not_minted':
      return 'no coin yet';
    case 'no_market':
      return 'no market yet';
    case 'not_read_yet':
      return 'reading';
    case 'not_reported':
      return 'not reported';
    case 'unreadable':
      return 'unavailable';
  }
}
