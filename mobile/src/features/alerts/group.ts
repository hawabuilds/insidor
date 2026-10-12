/**
 * The Alerts list's sections, Trador's: Today (since local midnight), This week (the six days
 * before), Earlier. Pure, so the boundaries are tested.
 */

export type Section = 'Today' | 'This week' | 'Earlier';

const DAY = 86_400_000;

export function sectionOf(at: number, now: number): Section {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const start = midnight.getTime();
  if (at >= start) return 'Today';
  if (at >= start - 6 * DAY) return 'This week';
  return 'Earlier';
}

export function grouped<T extends { readonly at: number }>(items: readonly T[], now: number): readonly { readonly section: Section; readonly items: readonly T[] }[] {
  const order: Section[] = ['Today', 'This week', 'Earlier'];
  return order.map((section) => ({ section, items: items.filter((i) => sectionOf(i.at, now) === section) })).filter((g) => g.items.length > 0);
}

/** The bell's count: nothing at zero, "9+" past nine, as Trador shows it. */
export const badgeText = (unread: number): string | null => (unread <= 0 ? null : unread > 9 ? '9+' : String(unread));
