/**
 * THE ARITHMETIC BEHIND A LONG LIST THAT ONLY DRAWS WHAT IS NEAR THE SCREEN (WindowList.tsx): where
 * each row starts, which rows are near the screen, and how far the page must move so the row the
 * person is looking at stays put when something above it changes height or arrives.
 *
 * Pure and separate from the component so the rules are tested rather than watched
 * (window-range.test.ts): an off-by-one here is a card that blinks out under a thumb.
 *
 * ★ A ROW NOT YET DRAWN IS COUNTED AT THE AVERAGE HEIGHT OF THE ROWS THAT HAVE BEEN, so the
 * space kept for the rows below the screen is close to what they will take, and the scroll bar
 * does not jump as they arrive. Before any row is measured, the caller's guess is used.
 *
 * What breaks if changed carelessly: `offsets` must have one more entry than there are rows (the
 * last is the whole list's height), and `anchorShift` must compare a row's start before and after
 * by KEY, never by index: a post arriving at the top moves every index by one.
 */

/** Where each row starts, from the top of the list, and the whole list's height last. */
export function rowOffsets<K>(keys: readonly K[], heights: ReadonlyMap<K, number>, guess: number): number[] {
  let measured = 0;
  let total = 0;
  for (const k of keys) {
    const h = heights.get(k);
    if (h !== undefined) {
      measured += 1;
      total += h;
    }
  }
  const unknown = measured === 0 ? guess : total / measured;
  const out = new Array<number>(keys.length + 1);
  out[0] = 0;
  for (let i = 0; i < keys.length; i++) out[i + 1] = (out[i] ?? 0) + (heights.get(keys[i] as K) ?? unknown);
  return out;
}

/** The first row whose bottom is below `y` (binary search over the offsets). */
export function rowAt(offsets: readonly number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((offsets[mid + 1] ?? Infinity) <= y) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(lo, Math.max(0, offsets.length - 2));
}

/**
 * The rows to draw: every row any part of which is within `overscan` pixels of the screen.
 * `top` is how far the screen's top is below the list's top (negative while the list is lower).
 * `end` is exclusive.
 */
export function rowsNear(offsets: readonly number[], top: number, height: number, overscan: number): { readonly start: number; readonly end: number } {
  const n = offsets.length - 1;
  if (n <= 0) return { start: 0, end: 0 };
  const start = rowAt(offsets, Math.max(0, top - overscan));
  const end = Math.min(n, rowAt(offsets, Math.max(0, top + height + overscan)) + 1);
  return { start, end: Math.max(end, start) };
}

/** How far the page must scroll to keep row `key` where it was: its start now minus its start then; 0 when it is gone. */
export function anchorShift<K>(key: K, was: number, keys: readonly K[], offsets: readonly number[]): number {
  const i = keys.indexOf(key);
  if (i < 0) return 0;
  return (offsets[i] ?? was) - was;
}
