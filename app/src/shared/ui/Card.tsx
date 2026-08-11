/**
 * A panel with a heading. The only layout primitive, because everything else in this app is
 * either a table row or a form, and both of those are features rather than primitives.
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

/** A small inline label. `alert` is the amber one, used for a mint that just landed. */
export function Tag({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return (
    <span className={`${styles['tag']} ${alert ? styles['tagAlert'] : ''}`}>{children}</span>
  );
}
