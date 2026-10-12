/**
 * The screen behind a tab that has nothing built behind it yet: Alerts.
 *
 * A plain statement rather than a mock of the screen to come. A mock would have to show
 * results, calls or balances, and every one of those would be a fiction on a surface whose
 * whole rule is that it shows facts.
 */

import styles from './soon.module.css';

const COPY = {
  alerts: { title: 'Alerts', body: 'Alerts about the narratives and coins you follow, as they happen.' },
  narratives: { title: 'Narratives', body: 'Viral posts grouped by the story they are about.' },
} as const;

export function ComingSoonScreen({ which }: { which: keyof typeof COPY }) {
  const copy = COPY[which];
  return (
    <section className={styles['screen']}>
      <h1 className={styles['title']}>{copy.title}</h1>
      <div className={styles['box']}>
        <b>Coming soon</b>
        <p>{copy.body}</p>
      </div>
    </section>
  );
}
