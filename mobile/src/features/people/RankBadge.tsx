/**
 * A rank's badge — Trador's art, with its glow for the top three ranks — and the small tag shown
 * beside a name. Drawn from public/ranks so every badge is one cached file.
 */

import type { RankId } from '../../shared/api/people.ts';
import { RANK_NAME } from './rank.ts';
import styles from './people.module.css';

export function RankBadge({ rank, size }: { rank: RankId; size: number }) {
  return <img className={`${styles['badge']} ${styles[`glow_${rank}`] ?? ''}`} src={`/ranks/${rank}.svg`} width={size} height={size} alt={RANK_NAME[rank]} style={{ ['--badge' as string]: `${size}px` }} />;
}

/** Beside a name: the badge small, and the rank's name. */
export function RankTag({ rank }: { rank: RankId }) {
  return (
    <span className={styles['tag']}>
      <RankBadge rank={rank} size={14} />
      {RANK_NAME[rank]}
    </span>
  );
}
