/**
 * HOW INSIDOR WORKS — Trador's "Learn the basics", reached from the profile menu: what the app
 * shows and how to read it, in five short parts.
 *
 * Its own screen rather than a sheet because it is read, not acted on, and a link to it should
 * survive a reload (`#/learn`).
 *
 * ★ IT DESCRIBES THE SCREENS, NEVER THE MACHINERY. Every sentence here has to stay true of what a
 * person sees: the origin labels are the ones the coin page shows (TokenPage's ORIGIN_LABEL), and
 * nothing explains how a match is made. A change to those labels changes this page too.
 */

import { BackIcon } from '../../shared/ui/icons.tsx';
import styles from './learn.module.css';

const PARTS: readonly { readonly title: string; readonly body: readonly string[] }[] = [
  {
    title: 'Narratives',
    body: ['Viral posts about the same thing, grouped together. The feed shows them as they rise, with views counted from the posts themselves.'],
  },
  {
    title: 'The coins they became',
    body: [
      'A narrative lists the coins made about it, and each coin says where it came from.',
      'Linked by creator: the coin itself links to the post.',
      'Matched by Insidor: the coin was matched to the post it is named after.',
      'Went viral after launch: the post came after the coin, so it is not where the coin came from.',
    ],
  },
  {
    title: "When we can't tell",
    body: ['A number we could not read is a dash with the reason under it, never a zero. Where we cannot tell which coin a narrative became, the narrative says so and offers no coin to buy.'],
  },
  {
    title: 'Only what happened',
    body: ['Insidor shows posts, narratives, coins and wallets as they are. When there is nothing yet, the screen says so; it never fills the space with made-up examples.'],
  },
  {
    title: 'Your wallet',
    body: [
      'A wallet is made for you when you sign in. Nobody, including us, ever sees its key.',
      'Buying and selling say Coming soon until trading is turned on.',
    ],
  },
];

export function Learn() {
  return (
    <section className={styles['screen']}>
      <button type="button" className={styles['back']} aria-label="Back" onClick={() => window.history.back()}>
        <BackIcon size={22} />
      </button>
      <h1 className={styles['title']}>How Insidor works</h1>
      {PARTS.map((part) => (
        <div key={part.title} className={styles['part']}>
          <h2>{part.title}</h2>
          {part.body.map((line) => <p key={line}>{line}</p>)}
        </div>
      ))}
    </section>
  );
}
