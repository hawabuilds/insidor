/**
 * THE RANK-UP — Trador's full-screen moment, shown once when a new rank appears in the alert
 * list: the badge, the season, "You're a Quant", the rank's line, "Share on X" and "Not now".
 * Seen-ness is kept on this device (the newest rank-up's id), as Trador keeps it.
 */

import { useEffect, useState } from 'react';

import { fetchAlerts, type RankId } from '../../shared/api/people.ts';
import { RankBadge } from './RankBadge.tsx';
import { RANK_LINE, RANK_NAME, shareText } from './rank.ts';
import styles from './people.module.css';

const SEEN = 'insidor.rankSeen';
const RANKS: readonly string[] = ['intern', 'analyst', 'quant', 'wolf', 'goat'];

function seen(): string | null {
  try {
    return localStorage.getItem(SEEN);
  } catch {
    return null;
  }
}

export function RankUp({ signedIn }: { signedIn: boolean }) {
  const [shown, setShown] = useState<{ id: number; rank: RankId; season: number } | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    fetchAlerts()
      .then(({ alerts }) => {
        const newest = alerts.find((a) => a.kind === 'rank_up' && a.rank !== null && RANKS.includes(a.rank));
        if (live && newest !== undefined && seen() !== String(newest.id) && newest.unread) setShown({ id: newest.id, rank: newest.rank as RankId, season: newest.season ?? 1 });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [signedIn]);
  if (shown === null) return null;
  const close = () => {
    try {
      localStorage.setItem(SEEN, String(shown.id));
    } catch {
      /* Not kept: it may show again, which is harmless. */
    }
    setShown(null);
  };
  return <RankUpView rank={shown.rank} season={shown.season} onClose={close} />;
}

export function RankUpView({ rank, season, onClose }: { rank: RankId; season: number; onClose: () => void }) {
  const share = `https://x.com/intent/post?text=${encodeURIComponent(shareText(rank, season))}`;
  return (
    <div className={styles['rankUp']} role="dialog" aria-label={`You're a ${RANK_NAME[rank]}`}>
      <div className={styles['rankUpInner']}>
        <RankBadge rank={rank} size={128} />
        <span className={styles['season']}>Season {season}</span>
        <h2 className={styles['rankUpTitle']}>You're a {RANK_NAME[rank]}</h2>
        <p className={styles['rankUpLine']}>{RANK_LINE[rank]}</p>
        <a className={styles['share']} href={share} target="_blank" rel="noreferrer" onClick={onClose}>Share on 𝕏</a>
        <button type="button" className={styles['notNow']} onClick={onClose}>Not now</button>
      </div>
    </div>
  );
}
