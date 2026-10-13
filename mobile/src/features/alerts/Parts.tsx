/**
 * THE PIECES THE FEED AND ITS NOTIFICATIONS SHARE, each one Trador's: the face at the left of a
 * row, a title with its ticker in bold, the bell with its count, the underline tabs under a page
 * title, the This week / All time toggle, the spinner that follows a pull down, and Load more at
 * the bottom of a list with more to read.
 *
 * Here rather than in shared/ui because only these two screens use them in this form; the app's
 * own UnderlineTabs is spread across the width with a rule under the row, which is not how
 * Trador's Feed tabs sit under its title.
 *
 * What breaks if changed carelessly: the bell's count is the only place unread notifications are
 * counted (the tab bar has no badge, as in Trador), so the bell must render whenever there is a
 * count, and nothing at zero.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { Alert, RankId } from '../../shared/api/people.ts';
import { hrefFor } from '../../shared/route.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { BellIcon } from '../../shared/ui/icons.tsx';
import { RankBadge } from '../people/RankBadge.tsx';
import { Avatar } from '../portfolio/Avatar.tsx';
import { badgeText } from './group.ts';
import { markOf } from './mark.ts';
import { pullProgress } from './pull.ts';
import { withTicker } from './split.ts';
import styles from './alerts.module.css';

const RANKS: readonly string[] = ['intern', 'analyst', 'quant', 'wolf', 'goat'];

/** The row's face: a picture (person, poster), a rank, a coin's logo, or Trador's brand-wash circle with a glyph. */
export function Mark({ a }: { a: Alert }) {
  const m = markOf(a, RANKS);
  if (m.kind === 'rank') return <RankBadge rank={m.rank as RankId} size={40} />;
  if (m.kind === 'coin') return <CoinLogo address={m.address ?? null} ticker={m.letter} size={40} />;
  if (m.kind === 'person') return <Avatar name={m.name} seed={m.name} src={m.picture ?? null} size={40} />;
  if (m.kind === 'rising') {
    const arrow = <span className={styles['face']} role="img" aria-label={m.label}>↑</span>;
    return m.picture !== undefined ? <Picture src={m.picture} fallback={arrow} /> : arrow;
  }
  if (m.kind === 'money') return <span className={styles['face']} role="img" aria-label={m.label}>$</span>;
  if (m.kind === 'learned') return <span className={styles['face']} role="img" aria-label={m.label}>↻</span>;
  return <span className={styles['face']}><BellIcon size={18} /></span>;
}

/** A 40px round picture; when it fails to load, the row's own fallback face instead of a broken image. */
function Picture({ src, fallback }: { src: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return <img src={src} alt="" width={40} height={40} loading="lazy" decoding="async" className={styles['picture']} onError={() => setFailed(true)} />;
}

/** The alert's title with its ticker bold, as Trador writes "<b>FERRY</b> graduated". */
export function Headline({ a }: { a: Alert }) {
  const [before, ticker, after] = withTicker(a.title, a.symbol);
  return (
    <>
      {before}
      {ticker !== '' ? <b>{ticker}</b> : null}
      {after}
    </>
  );
}

/** The way into Notifications, and the only place their count is shown. */
export function Bell({ unread }: { unread: number }) {
  const text = badgeText(unread);
  return (
    <a className={styles['iconButton']} href={hrefFor({ screen: 'notifications' })} aria-label={unread > 0 ? `Notifications, ${unread} new` : 'Notifications'}>
      <BellIcon size={21} />
      {text !== null ? <span className={styles['count']}>{text}</span> : null}
    </a>
  );
}

/** Trador's PanelTabs at `md`, `start`: labels together under the title, the current one underlined. */
export function PageTabs<K extends string>({ tabs, current, onChange, label }: { tabs: readonly { readonly key: K; readonly label: string }[]; current: K; onChange: (k: K) => void; label: string }) {
  return (
    <div className={styles['tabs']} role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={t.key === current} className={`${styles['tab']} ${t.key === current ? styles['tabOn'] : ''}`} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Trador's SegmentedToggle. */
export function Segmented<K extends string>({ options, current, onChange }: { options: readonly { readonly key: K; readonly label: string }[]; current: K; onChange: (k: K) => void }) {
  return (
    <div className={styles['segment']} role="group">
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={o.key === current} className={o.key === current ? styles['segmentOn'] : ''} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The spinner that follows the pull down from under the status bar. */
export function PullIndicator({ pull, refreshing }: { pull: number; refreshing: boolean }) {
  if (pull <= 0 && !refreshing) return null;
  const p = pullProgress(pull);
  return (
    <div aria-hidden="true" className={styles['pull']} style={{ transform: `translateY(${pull * 0.6}px)`, opacity: refreshing ? 1 : p }}>
      <span className={refreshing ? styles['spinning'] : ''} style={refreshing ? undefined : { transform: `rotate(${p * 270}deg)` }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 11a8 8 0 0 0-13.7-5.3L4 8m0 0V4m0 4h4M4 13a8 8 0 0 0 13.7 5.3L20 16m0 0v4m0-4h-4" />
        </svg>
      </span>
    </div>
  );
}

/**
 * Trador's LoadMore: the next page is read as the bottom comes within 400px (an observer, not a
 * scroll listener, so a fast flick does not stutter), and a button does the same for anyone not
 * scrolling. While a page is on its way the button says so and a second tap does nothing; it is
 * never shown disabled.
 */
export function LoadMore({ onLoad, loading }: { onLoad: () => void; loading: boolean }) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  /* Read through a ref: onLoad changes with every page, and rebuilding the observer mid-scroll can miss the crossing. */
  const latest = useRef(onLoad);
  useEffect(() => {
    latest.current = onLoad;
  }, [onLoad]);
  useEffect(() => {
    const node = sentinel.current;
    if (node === null || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) latest.current();
    }, { rootMargin: '400px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={sentinel} className={styles['more']}>
      <button type="button" className={styles['moreButton']} aria-busy={loading} onClick={() => (loading ? undefined : onLoad())}>
        {loading ? 'Loading' : 'Load more'}
      </button>
    </div>
  );
}
