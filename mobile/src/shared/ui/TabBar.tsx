/**
 * The floating pill tab bar, after Trador's `TabBar.tsx`.
 *
 * Floating rather than full width: it reads as a control over the feed instead of a frame
 * around it, and rows scrolling visibly under its blurred edge is what makes the app feel like
 * one surface. Icons only, with each label in `aria-label`.
 */

import { badgeText } from '../../features/alerts/group.ts';
import { hrefFor, type Tab } from '../route.ts';
import { ChatIcon, HomeIcon, LayersIcon, SearchIcon, WalletIcon } from './icons.tsx';
import styles from './ui.module.css';

const TABS = [
  { key: 'feed', label: 'For you', Icon: HomeIcon },
  { key: 'narratives', label: 'Narratives', Icon: LayersIcon },
  { key: 'search', label: 'Search', Icon: SearchIcon },
  { key: 'alerts', label: 'Feed', Icon: ChatIcon },
  { key: 'portfolio', label: 'Portfolio', Icon: WalletIcon },
] as const;

export function TabBar({ current, unread = 0 }: { current: Tab; unread?: number }) {
  return (
    <nav className={styles['tabbar']} aria-label="Primary">
      <div className={styles['tabbarPill']}>
        {TABS.map(({ key, label, Icon }) => (
          <a
            key={key}
            href={hrefFor({ screen: key })}
            aria-label={key === 'alerts' && unread > 0 ? `${label}, ${unread} new` : label}
            aria-current={key === current ? 'page' : undefined}
            className={`${styles['tabbarItem']} ${key === current ? styles['tabbarOn'] : ''}`}
          >
            <Icon size={21} />
            {key === 'alerts' && badgeText(unread) !== null ? <span className={styles['tabBadge']}>{badgeText(unread)}</span> : null}
          </a>
        ))}
      </div>
    </nav>
  );
}
