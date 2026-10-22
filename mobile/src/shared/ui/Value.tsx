/**
 * A formatted figure on screen: the text when there is one, and a dash with its reason when
 * there is not.
 *
 * The reason is in the accessible name and on hover, so "—" is never a bare glyph somebody has
 * to guess at. This is the one component every number on screen goes through, which is what
 * makes "an absence is a dash with a reason, never 0" a property of the app rather than of
 * each screen remembering it.
 */

import { pendingLabel, type Rendered } from '../format/rendered.ts';
import styles from './ui.module.css';

/** `num`: a money value, price, market cap, multiple or percentage, set in the number face (Num.tsx). */
export function Value({ r, className, num = false }: { r: Rendered; className?: string | undefined; num?: boolean }) {
  const cls = num ? `${styles['num']} ${className ?? ''}` : className;
  if (r.kind === 'value') return <span className={cls}>{r.text}</span>;
  const why = pendingLabel(r.reason);
  return (
    <span className={`${cls ?? ''} ${styles['pending']}`} title={why} aria-label={why}>
      {r.text}
    </span>
  );
}
