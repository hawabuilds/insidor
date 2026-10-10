/**
 * The screen behind a tab that has nothing built behind it yet: Search, Calls and Wallet.
 *
 * A plain statement rather than a mock of the screen to come. A mock would have to show
 * results, calls or balances, and every one of those would be a fiction on a surface whose
 * whole rule is that it shows facts.
 *
 * The Wallet tab connects nothing. Connecting a wallet must never make a new button appear,
 * and the simplest way to keep that true is not to connect one until there is a screen that
 * shows what it changed.
 */

import styles from './soon.module.css';

const COPY = {
  search: { title: 'Search', body: 'Search for a narrative, a post or a coin.' },
  calls: { title: 'Calls', body: 'Calls are what people say a narrative will do, and whether they were right.' },
  wallet: { title: 'Wallet', body: 'Connect a wallet to see what you hold.' },
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
