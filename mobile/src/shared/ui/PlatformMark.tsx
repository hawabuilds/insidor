/**
 * A platform's mark as a small round badge, in the platform's own colours.
 *
 * The badge colours are the platforms', not ours, and they are the one place a colour that is
 * not in tokens.css appears — a TikTok badge in Insidor blue would be a different claim.
 * An unknown platform draws nothing; see `platform.ts`.
 */

import type { Platform } from '../platform.ts';
import { InstagramMark, RedditMark, TikTokMark, XMark, YouTubeMark } from './icons.tsx';
import styles from './ui.module.css';

const MARKS = {
  x: XMark,
  tiktok: TikTokMark,
  youtube: YouTubeMark,
  reddit: RedditMark,
  instagram: InstagramMark,
} as const;

export function PlatformMark({ platform, size = 12 }: { platform: Platform; size?: number }) {
  const Mark = MARKS[platform];
  return <Mark size={size} />;
}

export function PlatformBadge({ platform, label }: { platform: Platform; label: string }) {
  return (
    <span className={`${styles['badge']} ${styles[`badge-${platform}`]}`} title={label} aria-label={label}>
      <PlatformMark platform={platform} />
    </span>
  );
}
