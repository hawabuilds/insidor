/**
 * How a ticker is written on screen: one `$`, then the symbol.
 *
 * Separate because the symbol arrives from more than one place, and some of them already carry
 * the `$` (a launchpad that stores "$GTAVI", an alert title written with it) while others do not.
 * Every surface that prefixed its own `$` drew "$$GTAVI" for the first kind. One function means
 * one rule: whatever `$`s the raw symbol starts with are dropped, and exactly one is put back.
 *
 * What breaks if changed carelessly: a caller that adds its own `$` around this brings the double
 * back, and one that stops calling it draws the raw symbol with or without its `$` depending on
 * where the coin came from.
 */

/** `GTAVI` and `$GTAVI` (and `$$GTAVI`) all read `$GTAVI`. */
export function tickerText(symbol: string): string {
  return `$${symbol.trim().replace(/^\$+/, '')}`;
}
