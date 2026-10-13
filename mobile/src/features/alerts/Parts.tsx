/**
 * THE PIECES THE FEED AND ITS NOTIFICATIONS SHARE, each one Trador's: the face at the left of a
 * row, a title with its ticker in bold, the bell with its count, the underline tabs under a page
 * title, and the This week / All time toggle.
 *
 * Here rather than in shared/ui because only these two screens use them in this form; the app's
 * own UnderlineTabs is spread across the width with a rule under the row, which is not how
 * Trador's Feed tabs sit under its title.
 *
 * What breaks if changed carelessly: the bell's count is the only place unread notifications are
 * counted (the tab bar has no badge, as in Trador), so the bell must render whenever there is a
 * count, and nothing at zero.
 */

import type { Alert, RankId } from '../../shared/api/people.ts';
import { hrefFor } from '../../shared/route.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { BellIcon } from '../../shared/ui/icons.tsx';
import { RankBadge } from '../people/RankBadge.tsx';
import { Avatar } from '../portfolio/Avatar.tsx';
import { badgeText } from './group.ts';
import { markOf } from './mark.ts';
import { withTicker } from './split.ts';
import styles from './alerts.module.css';

const RANKS: readonly string[] = ['intern', 'analyst', 'quant', 'wolf', 'goat'];

/** The row's face: rank, coin, or Trador's brand-wash circle with a glyph. */
export function Mark({ a }: { a: Alert }) {
  const m = markOf(a, RANKS);
  if (m.kind === 'rank') return <RankBadge rank={m.rank as RankId} size={40} />;
  if (m.kind === 'coin') return <CoinLogo address={m.address ?? null} ticker={m.letter} size={40} />;
  if (m.kind === 'person') return <Avatar name={m.name} seed={m.name} src={null} size={40} />;
  if (m.kind === 'rising') return <span className={styles['face']} role="img" aria-label={m.label}>↑</span>;
  if (m.kind === 'money') return <span className={styles['face']} role="img" aria-label={m.label}>$</span>;
  if (m.kind === 'learned') return <span className={styles['face']} role="img" aria-label={m.label}>↻</span>;
  return <span className={styles['face']}><BellIcon size={18} /></span>;
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
