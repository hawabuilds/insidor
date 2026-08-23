/**
 * A panel with a heading. The only layout primitive, because everything else in this app is
 * either a table row or a form, and both of those are features rather than primitives.
 *
 * The heading is optional and the empty case is a real branch: `title === undefined` renders
 * no `<h2>` at all rather than an empty one. A heading element with no text is announced by
 * a screen reader as a blank heading and lands in the document outline, so a card used as
 * plain grouping would add a rung to the heading ladder that sighted users cannot see.
 *
 * ★ NOTHING IN THE APP CURRENTLY RENDERS EITHER OF THESE. Both are exported through
 * `ui/index.ts` and imported by no feature — verified across `app/src`, where the only other
 * matches are an unrelated local `CoinCard` in story/Coins.tsx and a `chartTag` CSS class.
 * That is stated as an observation, not as an intent: unlike `trade/quote-state.ts`, which
 * argues in its own barrel for why it is kept unused, there is no record here of whether
 * these are staged for a surface not yet built or left behind by one that was. Anyone
 * deciding their fate should establish that first — and anyone adding a second panel
 * primitive should use this one instead, because two spellings of "box with a title" is how
 * the app ends up with two paddings.
 *
 * What breaks if the class names move: these are the styles in primitives.module.css
 * (`.card`, `.sectionTitle`, `.tag`, `.tagAlert`) and CSS Modules resolves a missing key to
 * `undefined`, which stringifies into the class list and fails silently — an unstyled panel,
 * never an error.
 */

import type { ReactNode } from 'react';
import styles from './primitives.module.css';

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={styles['card']}>
      {title === undefined ? null : <h2 className={styles['sectionTitle']}>{title}</h2>}
      {children}
    </section>
  );
}

/**
 * A small inline label. `alert` switches it to the `--alert` token — the one colour in the
 * palette reserved for "this just happened", which is why it is a boolean here rather than a
 * free-form tone: a label that can be any colour is a label that stops meaning anything.
 *
 * Colour is the ONLY thing the flag changes. Nothing about the text is altered, so an
 * alerting tag still has to say what it is; the amber is not carrying the message on its own,
 * which it could not do for a colour-blind reader anyway.
 */
export function Tag({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return (
    <span className={`${styles['tag']} ${alert ? styles['tagAlert'] : ''}`}>{children}</span>
  );
}
