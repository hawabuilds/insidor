/**
 * "Joined 3h ago" on the Invites lists: how long ago, in the largest whole unit, the way the Feed
 * writes a row's age. Pure, so the units run under `node --test`. A time in the future is a bad
 * clock, not a negative age: it reads "just now".
 */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export function agoOf(at: number, now: number): string {
  const d = now - at;
  if (d < MINUTE) return 'just now';
  if (d < HOUR) return `${Math.floor(d / MINUTE)}m ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`;
  return `${Math.floor(d / DAY)}d ago`;
}
