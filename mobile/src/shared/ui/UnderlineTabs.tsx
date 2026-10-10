/**
 * Tabs with a blue underline under the current one. Used by the feed, the narrative page and
 * the token page. Switching changes content in place; it never navigates.
 */

import type { ReactNode } from 'react';
import styles from './ui.module.css';

export function UnderlineTabs<K extends string>({
  tabs,
  current,
  onChange,
  label,
  spread = true,
}: {
  tabs: readonly { readonly key: K; readonly label: ReactNode }[];
  current: K;
  onChange: (key: K) => void;
  label: string;
  /** Spread across the width, or sit left-aligned at their natural width. */
  spread?: boolean;
}) {
  return (
    <div className={`${styles['tabs']} ${spread ? styles['tabsSpread'] : ''}`} role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === current}
          className={`${styles['tab']} ${t.key === current ? styles['tabOn'] : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
