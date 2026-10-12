/** Who follows someone, or whom they follow: a plain list, each row to that person's profile. */

import { PEOPLE_SAMPLE, fetchFollows } from '../../shared/api/people.ts';
import { useLoad } from '../../shared/hooks.ts';
import { PEOPLE_SAMPLE_NOTICE } from '../../shared/notice.ts';
import { hrefFor } from '../../shared/route.ts';
import { BackIcon } from '../../shared/ui/icons.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { Avatar } from '../portfolio/Avatar.tsx';
import { RankTag } from './RankBadge.tsx';
import styles from './people.module.css';

export function FollowList({ profileKey, which }: { profileKey: string; which: 'followers' | 'following' }) {
  const [loaded] = useLoad(`follows:${profileKey}:${which}`, () => fetchFollows(profileKey, which));
  return (
    <section className={styles['screen']}>
      <button type="button" className={styles['back']} aria-label="Back" onClick={() => window.history.back()}>
        <BackIcon size={22} />
      </button>
      <h1 className={styles['title']}>{which === 'followers' ? 'Followers' : 'Following'}</h1>
      {PEOPLE_SAMPLE ? <Notice notice={PEOPLE_SAMPLE_NOTICE} /> : null}
      {loaded.state === 'loading' ? <p className={styles['note']}>Loading.</p> : null}
      {loaded.state === 'failed' ? <p className={styles['note']}>This list couldn't be read just now.</p> : null}
      {loaded.state === 'ready' && loaded.value.length === 0 ? <p className={styles['note']}>{which === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}</p> : null}
      {loaded.state === 'ready'
        ? loaded.value.map((p) => (
            <a key={p.userId} className={styles['row']} href={hrefFor({ screen: 'profile', key: p.handle ?? p.userId })}>
              <Avatar name={p.name ?? p.handle} seed={p.userId} src={p.pictureUrl} size={40} />
              <div className={styles['rowText']}>
                <b>{p.name ?? `@${p.handle ?? 'someone'}`}</b>
                {p.handle !== null ? <span>@{p.handle}</span> : null}
              </div>
              <RankTag rank={p.rank} />
            </a>
          ))
        : null}
    </section>
  );
}
