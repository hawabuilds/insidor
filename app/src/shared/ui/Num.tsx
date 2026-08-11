/**
 * Every number in the product renders through here.
 *
 * It takes a `Rendered`, not a string and not a number, which means the missing-data
 * decision was already made by a formatter and cannot be re-made in a component. The two
 * branches are the two treatments: a value in mono tabular figures, or `<Pending>`.
 *
 * There is no `fallback` prop. A caller who wants "0" when there is no number has to type
 * the zero itself, somewhere a reviewer can see it.
 */

import type { Rendered } from '../format/rendered.ts';
import { Pending } from './Pending.tsx';
import styles from './primitives.module.css';

export function Num({
  rendered,
  dim = false,
  showWord = false,
}: {
  rendered: Rendered;
  dim?: boolean;
  showWord?: boolean;
}) {
  if (rendered.kind === 'pending') {
    return <Pending reason={rendered.reason} showWord={showWord} />;
  }
  return (
    <span className={`${styles['num']} ${dim ? styles['numDim'] : ''}`}>{rendered.text}</span>
  );
}
