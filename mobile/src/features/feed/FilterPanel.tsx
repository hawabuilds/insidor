/**
 * The filter dropdown under the feed's filter button.
 *
 * Edits a draft and applies it on "Show posts", so a half-made choice never reshuffles the
 * feed behind the panel. The view steps and posted windows are handed in as named constants
 * (`feed-filters.ts`) — this component compares nothing against a number of its own.
 */

import { useState } from 'react';
import { FILTER_PLATFORMS, type Platform } from '../../shared/platform.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { PlatformMark } from '../../shared/ui/PlatformMark.tsx';
import { NO_FILTERS, type CoinFilter, type FeedFilters, type PostedWindow, type ViewStep } from './feed-filters.ts';
import styles from './feed.module.css';

const COIN_CHOICES: readonly { readonly key: CoinFilter; readonly label: string }[] = [
  { key: 'any', label: 'Any' },
  { key: 'none', label: 'No coin yet' },
  { key: 'has', label: 'Has a coin' },
];

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`${styles['pill']} ${on ? styles['pillOn'] : ''}`} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

export function FilterPanel({
  applied,
  steps,
  windows,
  onApply,
  onClose,
}: {
  applied: FeedFilters;
  steps: readonly ViewStep[];
  windows: readonly PostedWindow[];
  onApply: (f: FeedFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<FeedFilters>(applied);
  const toggleSite = (p: Platform) =>
    setDraft((d) => ({ ...d, sites: d.sites.includes(p) ? d.sites.filter((s) => s !== p) : [...d.sites, p] }));

  return (
    <>
      <div className={styles['panelScrim']} onClick={onClose} />
      <div className={styles['panel']} role="dialog" aria-label="Filters">
        <div className={styles['panelHead']}>
          <h2>Filters</h2>
          <button type="button" className={styles['reset']} onClick={() => setDraft(NO_FILTERS)}>
            Reset
          </button>
        </div>

        <h3>Social site</h3>
        <div className={styles['pills']}>
          {FILTER_PLATFORMS.map((p) => (
            <Pill key={p.key} on={draft.sites.includes(p.key)} onClick={() => toggleSite(p.key)}>
              <PlatformMark platform={p.key} size={13} /> {p.label}
            </Pill>
          ))}
        </div>

        <h3>Views</h3>
        <div className={styles['pills']}>
          <Pill on={draft.views === null} onClick={() => setDraft((d) => ({ ...d, views: null }))}>Any</Pill>
          {steps.map((s) => (
            <Pill key={s.label} on={draft.views?.label === s.label} onClick={() => setDraft((d) => ({ ...d, views: s }))}>
              {s.label}
            </Pill>
          ))}
        </div>

        <h3>Posted</h3>
        <div className={styles['pills']}>
          {windows.map((w) => (
            <Pill
              key={w.label}
              on={draft.posted?.label === w.label}
              onClick={() => setDraft((d) => ({ ...d, posted: d.posted?.label === w.label ? null : w }))}
            >
              {w.label}
            </Pill>
          ))}
        </div>

        <h3>Coin</h3>
        <div className={styles['pills']}>
          {COIN_CHOICES.map((c) => (
            <Pill key={c.key} on={draft.coin === c.key} onClick={() => setDraft((d) => ({ ...d, coin: c.key }))}>
              {c.label}
            </Pill>
          ))}
        </div>

        <Button look="primary" size="large" className={styles['show']} onClick={() => onApply(draft)}>
          Show posts
        </Button>
      </div>
    </>
  );
}
