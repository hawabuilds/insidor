/**
 * A PERSON'S PROFILE — Trador's ProfileScreen and RankStanding, in Insidor: picture, name and
 * @handle from their sign-in, their wallet, the rank card ("N rep to Quant"), followers and
 * following, their bio (editable on one's own), and their recent comments.
 *
 * ★ A PERSON'S OWN NUMBERS ONLY. Rep, rank and counts are about this person and what others did
 * with their comments. Nothing on this screen rates a coin or a post.
 */

import { useState } from 'react';

import { follow, fetchProfile, saveBio, type Comment, type ProfileCard } from '../../shared/api/people.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { hrefFor } from '../../shared/route.ts';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { BackIcon } from '../../shared/ui/icons.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { Avatar } from '../portfolio/Avatar.tsx';
import { RankBadge, RankTag } from './RankBadge.tsx';
import { RANK_NAME, rankCardLine } from './rank.ts';
import styles from './people.module.css';
import { goBack } from '../../shared/nav.ts';

const short = (a: string) => `${a.slice(0, 5)}…${a.slice(-5)}`;

export function subjectHref(subject: string): string | null {
  const at = subject.indexOf(':');
  const kind = subject.slice(0, at);
  const id = subject.slice(at + 1);
  if (kind === 'story') return hrefFor({ screen: 'story', storyId: id });
  if (kind === 'coin') return hrefFor({ screen: 'token', coinId: id.startsWith('solana:') ? id : `solana:${id}` });
  return null;
}

export function RankCard({ p }: { p: ProfileCard }) {
  return (
    <div className={styles['card']}>
      <RankBadge rank={p.rank} size={64} />
      <div className={styles['cardText']}>
        <b>{RANK_NAME[p.rank]}</b>
        <span>{p.rep.toLocaleString('en-US')} rep in Season {p.season.id}</span>
        <span>{rankCardLine(p)}</span>
      </div>
    </div>
  );
}

export function ProfileScreen({ profileKey }: { profileKey: string }) {
  const [loaded, reload] = useLoad(`profile:${profileKey}`, () => fetchProfile(profileKey));
  return (
    <section className={styles['screen']}>
      <button type="button" className={styles['back']} aria-label="Back" onClick={() => goBack({ screen: 'portfolio' })}>
        <BackIcon size={22} />
      </button>
      {loaded.state === 'loading' ? <p className={styles['note']}>Loading.</p> : null}
      {loaded.state === 'failed' ? <p className={styles['note']}>This profile couldn't be read. It may not exist.</p> : null}
      {loaded.state === 'ready' ? <Body p={loaded.value.profile} comments={loaded.value.comments} reload={reload} /> : null}
    </section>
  );
}

function Body({ p, comments, reload }: { p: ProfileCard; comments: readonly Comment[]; reload: () => void }) {
  const now = useNow();
  const toast = useToast();
  const [following, setFollowing] = useState(p.iFollow);
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState(p.bio);
  const key = p.handle ?? p.userId;

  const toggleFollow = async () => {
    const next = !following;
    setFollowing(next);
    try {
      await follow(p.userId, next);
    } catch (e) {
      setFollowing(!next);
      toast("Couldn't follow", e instanceof Error ? e.message : '');
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
        <Avatar name={p.name ?? p.handle} seed={p.userId} src={p.pictureUrl} size={64} />
        <div className={styles['headText']}>
          <h1 className={styles['name']}>{p.name ?? (p.handle !== null ? `@${p.handle}` : 'Someone')}</h1>
          {p.handle !== null ? <span className={styles['handle']}>@{p.handle}</span> : null}{' '}
          <RankTag rank={p.rank} />
        </div>
      </div>
      {editing ? (
        <>
          <textarea className={styles['bioField']} value={bio} maxLength={160} onChange={(e) => setBio(e.target.value)} aria-label="Bio" />
          <div className={styles['actions']}>
            <button type="button" className={styles['ghost']} onClick={() => setEditing(false)}>Cancel</button>
            <button type="button" className={styles['follow']} onClick={() => void save()}>Save bio</button>
          </div>
        </>
      ) : p.bio !== '' ? (
        <p className={styles['bio']}>{p.bio}</p>
      ) : null}
      <div className={styles['counts']}>
        <a href={hrefFor({ screen: 'follows', key, which: 'followers' })}><b>{p.followers.toLocaleString('en-US')}</b> followers</a>
        <a href={hrefFor({ screen: 'follows', key, which: 'following' })}><b>{p.following.toLocaleString('en-US')}</b> following</a>
        {p.wallet !== null ? <span>{short(p.wallet)}</span> : null}
      </div>
      <div className={styles['actions']}>
        {p.isMe ? (
          !editing ? <button type="button" className={styles['ghost']} onClick={() => setEditing(true)}>Edit bio</button> : null
        ) : (
          <button type="button" className={following ? styles['ghost'] : styles['follow']} onClick={() => void toggleFollow()}>
            {following ? 'Following' : p.followsMe ? 'Follow back' : 'Follow'}
          </button>
        )}
        <a className={styles['ghost']} style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }} href={hrefFor({ screen: 'leaderboard' })}>Leaderboard</a>
      </div>
      <RankCard p={p} />
      <h2 className={styles['section']}>Comments</h2>
      {comments.length === 0 ? <p className={styles['note']}>No comments yet.</p> : null}
      {comments.map((c) => {
        const href = subjectHref(c.subject);
        const inner = (
          <div className={styles['rowText']}>
            <b>{c.body}</b>
            <span>
              <Value r={formatAge({ known: true, at: c.at as never }, now as never)} />, {c.likes} {c.likes === 1 ? 'like' : 'likes'}
            </span>
          </div>
        );
        return href === null ? <div key={c.id} className={styles['row']}>{inner}</div> : <a key={c.id} className={styles['row']} href={href}>{inner}</a>;
      })}
    </>
  );
}
