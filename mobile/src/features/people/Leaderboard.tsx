/**
 * THE SEASON LEADERBOARD: everyone with rep this season, most first, with their rank. Rep is
 * each person's own — earned from holders liking their comments — never a measure of a coin.
 */

import { fetchLeaderboard } from '../../shared/api/people.ts';
import { useLoad } from '../../shared/hooks.ts';
import { hrefFor } from '../../shared/route.ts';
import { BackIcon } from '../../shared/ui/icons.tsx';
import { Avatar } from '../portfolio/Avatar.tsx';
import { RankBadge } from './RankBadge.tsx';
import { RANK_NAME } from './rank.ts';
import styles from './people.module.css';

const endsOn = (ms: number) => new Date(ms - 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

export function Leaderboard() {
  const [loaded] = useLoad('leaderboard', () => fetchLeaderboard());
  return (
    <section className={styles['screen']}>
      <button type="button" className={styles['back']} aria-label="Back" onClick={() => window.history.back()}>
        <BackIcon size={22} />
      </button>
      <h1 className={styles['title']}>Leaderboard</h1>
      {loaded.state === 'ready' ? <p className={styles['note']}>Season {loaded.value.season.id}, ends {endsOn(loaded.value.season.endsAt)}. Rep comes from holders liking your comments.</p> : null}
      {loaded.state === 'loading' ? <p className={styles['note']}>Loading.</p> : null}
      {loaded.state === 'failed' ? <p className={styles['note']}>The leaderboard couldn't be read just now.</p> : null}
      {loaded.state === 'ready' && loaded.value.rows.length === 0 ? <p className={styles['note']}>Nobody has rep this season yet.</p> : null}
      {loaded.state === 'ready'
        ? loaded.value.rows.map((r) => (
            <a key={r.userId} className={`${styles['row']} ${r.isMe ? styles['me'] : ''}`} href={hrefFor({ screen: 'profile', key: r.handle ?? r.userId })}>
              <span className={styles['position']}>{r.position}</span>
              <Avatar name={r.name ?? r.handle} seed={r.userId} src={r.pictureUrl} size={40} />
              <div className={styles['rowText']}>
                <b>{r.name ?? `@${r.handle ?? 'someone'}`}</b>
                <span>{RANK_NAME[r.rank]}</span>
              </div>
              <RankBadge rank={r.rank} size={26} />
              <span className={styles['rep']}>{r.rep.toLocaleString('en-US')}</span>
            </a>
          ))
        : null}
    </section>
  );
}
