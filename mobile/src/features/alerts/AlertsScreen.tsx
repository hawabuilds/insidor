/**
 * THE ALERTS TAB — Trador's notifications screen: everything that happened to your coins, the
 * narratives you watch and your comments, grouped Today, This week, Earlier, with what is new
 * since you last looked highlighted. Opening it marks everything read, as Trador does.
 *
 * Every row is a fact (a price level, a curve, a post's views, a person) and opens where it
 * happened. The gear opens the settings.
 */

import { useEffect, useRef } from 'react';

import { PEOPLE_SAMPLE, fetchAlerts, markAlertsSeen, type Alert, type RankId } from '../../shared/api/people.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { PEOPLE_SAMPLE_NOTICE } from '../../shared/notice.ts';
import { hrefFor } from '../../shared/route.ts';
import { BellIcon, GearIcon } from '../../shared/ui/icons.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { RankBadge } from '../people/RankBadge.tsx';
import { grouped } from './group.ts';
import styles from './alerts.module.css';

const RANKS: readonly string[] = ['intern', 'analyst', 'quant', 'wolf', 'goat'];

function Mark({ a }: { a: Alert }) {
  if (a.rank !== null && RANKS.includes(a.rank)) return <RankBadge rank={a.rank as RankId} size={40} />;
  if (a.symbol !== null) return <span className={styles['coin']}>{a.symbol.charAt(0)}</span>;
  return <span className={styles['coin']}><BellIcon size={18} /></span>;
}

export function AlertsScreen({ onSeen }: { onSeen: () => void }) {
  const now = useNow();
  const [loaded] = useLoad('alerts', () => fetchAlerts());
  const marked = useRef(false);
  useEffect(() => {
    if (loaded.state !== 'ready' || marked.current) return;
    marked.current = true;
    void markAlertsSeen().then(onSeen, () => undefined);
  }, [loaded.state, onSeen]);

  return (
    <section className={styles['screen']}>
      <header className={styles['top']}>
        <h1 className={styles['title']}>Alerts</h1>
        <a className={styles['gear']} href={hrefFor({ screen: 'alert-settings' })} aria-label="Alert settings">
          <GearIcon size={20} />
        </a>
      </header>
      {PEOPLE_SAMPLE ? <Notice notice={PEOPLE_SAMPLE_NOTICE} /> : null}
      {loaded.state === 'loading' ? <p className={styles['note']}>Loading.</p> : null}
      {loaded.state === 'failed' ? <p className={styles['note']}>Your alerts couldn't be read just now.</p> : null}
      {loaded.state === 'ready' && loaded.value.alerts.length === 0 ? <p className={styles['note']}>Alerts about your coins, the narratives you watch and replies to you land here.</p> : null}
      {loaded.state === 'ready'
        ? grouped(loaded.value.alerts, now).map((g) => (
            <div key={g.section}>
              <h2 className={styles['section']}>{g.section}</h2>
              {g.items.map((a) => (
                <a key={a.id} href={a.href.startsWith('/') ? a.href.replace(/^\//, '') || '#/' : '#/'} className={`${styles['row']} ${a.unread ? styles['unread'] : ''}`}>
                  <Mark a={a} />
                  <div className={styles['text']}>
                    <b>{a.title}</b>
                    <span>{a.body}</span>
                  </div>
                  <span className={styles['age']}><Value r={formatAge({ known: true, at: a.at as never }, now as never)} /></span>
                </a>
              ))}
            </div>
          ))
        : null}
    </section>
  );
}
