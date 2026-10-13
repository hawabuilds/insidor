/**
 * NOTIFICATIONS, behind the Feed's bell — Trador's (app/(app)/notifications/NotificationsScreen.tsx)
 * with Insidor's items: what happened to you. Your coins' multiples and curves, the narratives you
 * watch reaching a multiple, follows, replies, a rank-up, and for the owner the supplier and
 * learning reports.
 *
 * Trador's rules, kept: no tabs and no filters (only things about you reach it, so it is short
 * enough to read to the end); grouped Today, This week, Earlier; what is new is a soft purple row,
 * not a dot, and the line between new and read is fixed when the screen opens so rows do not lose
 * their tint while being read; opening it marks everything read. The gear opens Feed settings in a
 * sheet over the list, and `#/feed/settings` opens the list with the sheet already up.
 */

import { useEffect, useRef, useState } from 'react';

import { markAlertsSeen } from '../../shared/api/people.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { useNow } from '../../shared/hooks.ts';
import { hrefFor } from '../../shared/route.ts';
import { GearIcon } from '../../shared/ui/icons.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { SettingsSheet } from './AlertSettings.tsx';
import { linkOf } from './AlertsScreen.tsx';
import { grouped } from './group.ts';
import { useAlertList } from './list.ts';
import { Headline, Mark, PullIndicator } from './Parts.tsx';
import { pullStyle, usePullToRefresh } from './pull.ts';
import { notifications } from './split.ts';
import styles from './alerts.module.css';

export function NotificationsScreen({ settings, onSeen }: { settings: boolean; onSeen: () => void }) {
  const now = useNow();
  const { list, refresh } = useAlertList();
  const [sheet, setSheet] = useState(settings);
  useEffect(() => setSheet(settings), [settings]);
  const { pull, refreshing } = usePullToRefresh(refresh);

  /* Unread as it stood when the list first arrived: marking it read does not untint what is on screen. */
  const openedUnread = useRef<ReadonlySet<number> | null>(null);
  if (openedUnread.current === null && list.state === 'ready') openedUnread.current = new Set(list.value.alerts.filter((a) => a.unread).map((a) => a.id));
  const marked = useRef(false);
  useEffect(() => {
    if (list.state !== 'ready' || marked.current) return;
    marked.current = true;
    void markAlertsSeen().then(onSeen, () => undefined);
  }, [list.state, onSeen]);

  const closeSheet = () => {
    setSheet(false);
    if (settings) window.location.replace(hrefFor({ screen: 'notifications' }));
  };
  const items = list.state === 'ready' ? notifications(list.value.alerts) : [];

  return (
    <>
      <PullIndicator pull={pull} refreshing={refreshing} />
      <section className={styles['page']} style={pullStyle(pull)}>
        <header className={styles['sticky']}>
          <div className={`${styles['titleRow']} ${styles['titleOnly']}`}>
            <h1 className={styles['title']}>Notifications</h1>
            <button type="button" className={styles['iconButton']} aria-label="Feed settings" onClick={() => setSheet(true)}>
              <GearIcon size={19} />
            </button>
          </div>
        </header>

        {list.state === 'loading' ? <p className={styles['centred']}>Loading</p> : null}
        {list.state === 'failed' ? <p className={styles['centred']}>Could not load your notifications. Pull down to try again.</p> : null}
        {list.state === 'ready' && items.length === 0 ? <p className={styles['centred']}>Your coins' multiples and graduations, new followers and replies land here.</p> : null}
        {grouped(items, now).map((g) => (
          <section key={g.section}>
            <h2 className={styles['section']}>{g.section}</h2>
            <ul className={styles['list']}>
              {g.items.map((a) => (
                <li key={a.id}>
                  <a href={linkOf(a.href)} className={`${styles['note']} ${openedUnread.current?.has(a.id) === true ? styles['unread'] : ''}`}>
                    <Mark a={a} />
                    <div className={styles['noteText']}>
                      <p className={styles['noteHead']}>
                        <Headline a={a} />
                      </p>
                      {a.body !== '' ? <p className={styles['noteBody']}>{a.body}</p> : null}
                      <p className={styles['noteAge']}>
                        <Value r={formatAge({ known: true, at: a.at as never }, now as never)} />
                      </p>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>
      {sheet ? <SettingsSheet onClose={closeSheet} /> : null}
    </>
  );
}
