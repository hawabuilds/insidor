/**
 * A screen's title row and its title, the same on every tab and every page with a title row, so
 * the headings sit on one line as the tab bar moves between them (screen-header.module.css says
 * where the row is and why the status bar is not added here).
 *
 * Separate from the screens because the position is one decision, not five: a screen that places
 * its own heading again is how they drifted apart. A screen passes what belongs in its row (Back,
 * the title, a bell or a gear) and may add a class for its own gaps and the room under the row;
 * it never moves the row itself.
 */

import type { ReactNode } from 'react';
import styles from './screen-header.module.css';

export function ScreenHeader({
  children,
  as: Tag = 'div',
  gutter = false,
  className,
}: {
  children: ReactNode;
  /** `header` where the row is the screen's whole header; `div` inside a header that holds more. */
  as?: 'header' | 'div';
  /** Side padding, for a screen whose container has none. */
  gutter?: boolean;
  className?: string | undefined;
}) {
  const cls = [styles['head'], gutter ? styles['gutter'] : '', className ?? ''].filter(Boolean).join(' ');
  return <Tag className={cls}>{children}</Tag>;
}

/** The page title in the shared face. `grow` takes the row's middle, so what follows sits at the right edge. */
export function ScreenTitle({ children, grow = false }: { children: ReactNode; grow?: boolean }) {
  return <h1 className={grow ? `${styles['title']} ${styles['grow']}` : styles['title']}>{children}</h1>;
}
