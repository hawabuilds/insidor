/**
 * THE BELL, AT THE RIGHT OF EVERY TAB'S TITLE ROW (the owner, 2026-11-04, layout A). It opens
 * Notifications from For You, Narratives, Search, the Feed and the Portfolio alike, with the unread
 * count on it — a number, not a dot, so a trader sees at a glance whether a coin alert is waiting.
 *
 * Its own component because five headers draw it: one look, one place for its words and size.
 *
 * What breaks if changed carelessly: the count comes from shared/unread.ts (App's one read); the
 * link is the route's own (`hrefFor`), so the back gesture and the history stay right.
 */
import { hrefFor } from '../route.ts';
import { useUnread } from '../unread.ts';
import { BellIcon } from './icons.tsx';
import styles from './notification-bell.module.css';

/** `className` replaces the round bell's look, for a header that draws its own buttons (the Portfolio's glass ones over its banner). */
export function NotificationBell({ className }: { className?: string | undefined } = {}) {
  const unread = useUnread();
  const label = unread > 0 ? `Notifications, ${unread} new` : 'Notifications';
  return (
    <a className={className === undefined ? styles['bell'] : `${className} ${styles['positioned']}`} href={hrefFor({ screen: 'notifications' })} aria-label={label}>
      <BellIcon size={20} />
      {unread > 0 ? <span className={styles['count']}>{unread > 9 ? '9+' : unread}</span> : null}
    </a>
  );
}
