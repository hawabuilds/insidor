/**
 * A PERSON'S PROFILE — Trador's /u/[handle], cut to what a glance needs: back, the picture, name
 * and @handle with Follow / Following at the right (none on your own), their rank as one small
 * pill ("Intern, 0 rep"), the bio, "2 followers  1 following" (each opens its list), then their
 * portfolio: the total with "Portfolio value" under it and HOLDINGS, the same short rows as your
 * own Portfolio (portfolio/HoldingRow.tsx), SOL first. On your own profile, Edit bio sits quietly
 * at the bottom; the switch "Show my trades to followers" is in the Portfolio's gear, as Trador's
 * is ("Hide it from the gear on your Stonkfolio").
 *
 * ★ A PRIVATE PORTFOLIO IS SAID, NOT DRAWN EMPTY. The social service withholds the wallet unless
 * "Show my trades to followers" is on (Trador's `portfolio_public`, one switch for the Feed and the
 * profile, on by default as Trador's is); turned off, this says "@handle keeps their portfolio
 * private." Your own is always shown to you. No wallet address is shown: the rows are the facts.
 *
 * ★ THE SAME NUMBERS AS YOUR OWN PORTFOLIO, FOR EVERYONE. Trador shows another person's exact gain
 * on each coin, not "in profit / at a loss", and so does this; a coin not bought in Insidor shows
 * "—". The note saying why is on your own Portfolio and your own profile, not on other people's.
 *
 * ★ A PERSON'S OWN NUMBERS ONLY. Rep, rank and counts are about this person and what others did
 * with their comments. Nothing on this screen rates a coin or a post.
 */

import { useState } from 'react';

import { fetchPortfolio, type Portfolio as PortfolioData } from '../../shared/api/index.ts';
import { follow, fetchProfile, saveBio, type ProfileCard } from '../../shared/api/people.ts';
import { formatUsd } from '../../shared/format/number.ts';
import { useLoad } from '../../shared/hooks.ts';
import { hrefFor } from '../../shared/route.ts';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { BackIcon } from '../../shared/ui/icons.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { Avatar } from '../portfolio/Avatar.tsx';
import { Holdings } from '../portfolio/HoldingRow.tsx';
import folio from '../portfolio/portfolio.module.css';
import { gainsNote } from '../portfolio/wallet-view.ts';
import { RankBadge } from './RankBadge.tsx';
import { RANK_NAME } from './rank.ts';
import styles from './people.module.css';
import { goBack } from '../../shared/nav.ts';

/** The rank as one small pill: its badge, "Intern, 0 rep". */
export function RankPill({ p }: { p: ProfileCard }) {
  return (
    <span className={styles['rankPill']}>
      <RankBadge rank={p.rank} size={16} />
      {RANK_NAME[p.rank]}, {p.rep.toLocaleString('en-US')} rep
    </span>
  );
}

export function ProfileScreen({ profileKey }: { profileKey: string }) {
  const [loaded, reload] = useLoad(`profile:${profileKey}`, () => fetchProfile(profileKey), 'memory');
  return (
    <section className={styles['screen']}>
      <button type="button" className={styles['back']} aria-label="Back" onClick={() => goBack({ screen: 'portfolio' })}>
        <BackIcon size={22} />
      </button>
      {loaded.state === 'loading' ? (
        <div className={styles['head']}>
          <span className={styles['skAvatar']} />
          <span className={styles['skName']} />
        </div>
      ) : null}
      {loaded.state === 'failed' ? <p className={styles['note']}>No account @{profileKey}. Nobody has claimed this handle here yet, or it could not be read just now.</p> : null}
      {loaded.state === 'ready' ? <Body p={loaded.value.profile} reload={reload} /> : null}
    </section>
  );
}

function Body({ p, reload }: { p: ProfileCard; reload: () => void }) {
  const toast = useToast();
  const [following, setFollowing] = useState(p.iFollow);
  const [followers, setFollowers] = useState(p.followers);
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState(p.bio);
  const key = p.handle ?? p.userId;
  const at = p.handle !== null ? `@${p.handle}` : (p.name ?? 'This person');

  const toggleFollow = async () => {
    const next = !following;
    setFollowing(next);
    setFollowers((n) => n + (next ? 1 : -1));
    try {
      await follow(p.userId, next);
    } catch (e) {
      setFollowing(!next);
      setFollowers((n) => n + (next ? -1 : 1));
      toast("Couldn't update that follow", e instanceof Error ? e.message : '');
    }
  };

  const save = async () => {
    try {
      await saveBio(bio);
      setEditing(false);
      reload();
    } catch (e) {
      toast("Couldn't save", e instanceof Error ? e.message : '');
    }
  };

  return (
    <>
      <div className={styles['head']}>
        <Avatar name={p.name ?? p.handle} seed={p.userId} src={p.pictureUrl} size={48} />
        <div className={styles['headText']}>
          <h1 className={styles['name']}>{p.name ?? at}</h1>
          {p.handle !== null ? <div className={styles['handle']}>@{p.handle}</div> : null}
        </div>
        {p.isMe ? null : (
          <button type="button" className={following ? styles['pillGhost'] : styles['pillFollow']} onClick={() => void toggleFollow()}>
            {following ? 'Following' : p.followsMe ? 'Follow back' : 'Follow'}
          </button>
        )}
      </div>

      <div className={styles['rankRow']}><RankPill p={p} /></div>

      {p.bio !== '' && !editing ? <p className={styles['bio']}>{p.bio}</p> : null}

      <div className={styles['counts']}>
        <a href={hrefFor({ screen: 'follows', key, which: 'followers' })}><b>{followers.toLocaleString('en-US')}</b> followers</a>
        <a href={hrefFor({ screen: 'follows', key, which: 'following' })}><b>{p.following.toLocaleString('en-US')}</b> following</a>
      </div>

      {p.portfolio === 'shown' && p.wallet !== null ? (
        <PublicPortfolio wallet={p.wallet} at={at} self={p.isMe} />
      ) : p.portfolio === 'private' ? (
        <p className={styles['private']}>{at} keeps their portfolio private.</p>
      ) : (
        <p className={styles['private']}>— {at} has no wallet on Insidor yet, so there is no portfolio to show.</p>
      )}

      {p.isMe ? (
        <div className={styles['mine']}>
          {editing ? (
            <>
              <textarea className={styles['bioField']} value={bio} maxLength={160} onChange={(e) => setBio(e.target.value)} aria-label="Bio" />
              <div className={styles['actions']}>
                <button type="button" className={styles['ghost']} onClick={() => setEditing(false)}>Cancel</button>
                <button type="button" className={styles['follow']} onClick={() => void save()}>Save bio</button>
              </div>
            </>
          ) : (
            <button type="button" className={styles['quiet']} onClick={() => setEditing(true)}>Edit bio</button>
          )}
        </div>
      ) : null}
    </>
  );
}

/**
 * Someone's portfolio on their profile — Trador's PublicStonkfolio, cut down: the total with
 * "Portfolio value" under it, then HOLDINGS with the same rows as your own Portfolio. A list only:
 * Trador keeps the pie for your own allocation, and Insidor has no pie.
 */
function PublicPortfolio({ wallet, at, self }: { wallet: string; at: string; self: boolean }) {
  const [loaded] = useLoad(`wallet:${wallet}`, (signal) => fetchPortfolio(wallet, '24h', signal), 'memory');
  const data: PortfolioData | null = loaded.state === 'ready' ? loaded.value : loaded.state === 'failed' ? { kind: 'unavailable' } : null;
  const read = data !== null && data.kind === 'read' ? data : null;
  return (
    <section className={styles['folio']}>
      <div className={styles['folioBig']}>{read === null ? '—' : <Value r={formatUsd(read.totalUsd)} />}</div>
      <div className={styles['folioLabel']}>Portfolio value</div>

      {data === null ? (
        <ul className={folio['list']}>
          {[0, 1, 2].map((i) => (
            <li key={i} className={folio['skeleton']}><span className={folio['skDot']} /><span className={folio['skLines']}><span /><span /></span></li>
          ))}
        </ul>
      ) : data.kind === 'unavailable' ? (
        <p className={styles['note']}>— what this wallet holds could not be read just now.</p>
      ) : (
        <>
          <Holdings data={data} />
          {data.holdings.length === 0 ? <p className={styles['note']}>{at} holds no coins yet.</p> : null}
          {self && data.holdings.length > 0 ? <p className={folio['foot']}>{gainsNote(data.holdings)}</p> : null}
        </>
      )}
    </section>
  );
}
