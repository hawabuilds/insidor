/**
 * A PERSON'S PROFILE — Trador's /u/[handle] ProfileScreen, in Insidor's colours, in its order: the
 * picture, name and @handle with Follow / Following for someone else, the rank card (RankStanding,
 * "N rep to Quant"), the bio, followers and following (each opens its list), then their portfolio
 * (Trador's PublicStonkfolio): its value, their SOL, what is not priced, the wallet, and one row
 * per coin with its gain (portfolio/HoldingRow.tsx, the same row as your own Portfolio).
 *
 * ★ A PRIVATE PORTFOLIO IS SAID, NOT DRAWN EMPTY. The social service withholds the wallet unless
 * "Show my trades to followers" is on (Trador's `portfolio_public`, one switch for the Feed and the
 * profile, on by default as Trador's is); turned off, this says "@handle keeps their portfolio
 * private." Your own is always shown to
 * you, with a line saying whether others see it.
 *
 * ★ THE SAME NUMBERS AS YOUR OWN PORTFOLIO, FOR EVERYONE. Trador shows another person's exact gain
 * on each coin, not "in profit / at a loss", and so does this; the gain is only for buys made in
 * Insidor, else a dash with its reason.
 *
 * Nothing Trador's profile lacks: no tabs, no comment list, no leaderboard button. Two things are
 * Insidor's own: Edit bio on your own (Trador edits it in a sheet on the Stonkfolio) and the switch
 * block below, which lives here rather than in a settings gear.
 *
 * ★ A PERSON'S OWN NUMBERS ONLY. Rep, rank and counts are about this person and what others did
 * with their comments. Nothing on this screen rates a coin or a post.
 */

import { useState } from 'react';

import { fetchPortfolio, type Portfolio as PortfolioData } from '../../shared/api/index.ts';
import { saveTradesPublic } from '../../shared/api/following.ts';
import { follow, fetchProfile, saveBio, type ProfileCard } from '../../shared/api/people.ts';
import { formatUsd } from '../../shared/format/number.ts';
import { useLoad } from '../../shared/hooks.ts';
import { hrefFor } from '../../shared/route.ts';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { BackIcon } from '../../shared/ui/icons.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { Avatar } from '../portfolio/Avatar.tsx';
import { HoldingRow } from '../portfolio/HoldingRow.tsx';
import { GAINS_NOTE } from '../portfolio/Portfolio.tsx';
import folio from '../portfolio/portfolio.module.css';
import { RankBadge } from './RankBadge.tsx';
import { RANK_NAME, rankCardLine } from './rank.ts';
import styles from './people.module.css';
import { goBack } from '../../shared/nav.ts';

/** Trador's shortPubkey(wallet, 4, 4). */
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

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
        <Avatar name={p.name ?? p.handle} seed={p.userId} src={p.pictureUrl} size={56} />
        <div className={styles['headText']}>
          <h1 className={styles['name']}>{p.name ?? at}</h1>
          {p.handle !== null ? <div className={styles['handle']}>@{p.handle}</div> : null}
        </div>
        {p.isMe ? (
          !editing ? <button type="button" className={styles['pillGhost']} onClick={() => setEditing(true)}>Edit bio</button> : null
        ) : (
          <button type="button" className={following ? styles['pillGhost'] : styles['pillFollow']} onClick={() => void toggleFollow()}>
            {following ? 'Following' : 'Follow'}
          </button>
        )}
      </div>

      <RankCard p={p} />

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
        <a href={hrefFor({ screen: 'follows', key, which: 'followers' })}><b>{followers.toLocaleString('en-US')}</b> followers</a>
        <a href={hrefFor({ screen: 'follows', key, which: 'following' })}><b>{p.following.toLocaleString('en-US')}</b> following</a>
      </div>

      {/* ── Show my trades to followers (the Feed's switch; it also decides whether others see the portfolio below) ── */}
      {p.isMe && typeof p.tradesPublic === 'boolean' ? <ShareTrades on={p.tradesPublic} /> : null}
      {/* ── end of the switch block ── */}

      {p.portfolio === 'shown' && p.wallet !== null ? (
        <PublicPortfolio wallet={p.wallet} at={at} self={p.isMe} othersSee={p.isMe ? p.tradesPublic === true : true} />
      ) : p.portfolio === 'private' ? (
        <p className={styles['private']}>{at} keeps their portfolio private.</p>
      ) : (
        <p className={styles['private']}>— {at} has no wallet on Insidor yet, so there is no portfolio to show.</p>
      )}
    </>
  );
}

/**
 * Someone's portfolio on their profile — Trador's PublicStonkfolio: "Portfolio value", their SOL,
 * what is not priced, the wallet, and the same rows as your own Portfolio. A list only: Trador keeps
 * the pie for your own allocation, and Insidor has no pie.
 */
function PublicPortfolio({ wallet, at, self, othersSee }: { wallet: string; at: string; self: boolean; othersSee: boolean }) {
  const [loaded] = useLoad(`wallet:${wallet}`, (signal) => fetchPortfolio(wallet, '24h', signal), 'memory');
  const data: PortfolioData | null = loaded.state === 'ready' ? loaded.value : loaded.state === 'failed' ? { kind: 'unavailable' } : null;
  const read = data !== null && data.kind === 'read' ? data : null;
  return (
    <section className={styles['folio']}>
      <div className={folio['label']}>Portfolio value</div>
      <div className={styles['folioBig']}>{read === null ? '—' : <Value r={formatUsd(read.totalUsd)} />}</div>
      <div className={styles['folioSub']}>
        {read !== null ? <span>{read.solBalance.known ? read.solBalance.amount.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—'} SOL</span> : null}
        {read !== null && read.unpriced > 0 ? <span>{read.unpriced.toLocaleString('en-US')} not priced here</span> : null}
        <span className={styles['folioWallet']}>{short(wallet)}</span>
      </div>
      {self ? (
        <p className={styles['folioNote']}>
          {othersSee ? 'Others see this. Hide it with Show my trades to followers.' : 'Only you see this. Others see it once Show my trades to followers is on.'}
        </p>
      ) : null}

      {data === null ? (
        <ul className={folio['list']} style={{ marginTop: 16 }}>
          {[0, 1, 2].map((i) => (
            <li key={i} className={folio['skeleton']}><span className={folio['skDot']} /><span className={folio['skLines']}><span /><span /></span></li>
          ))}
        </ul>
      ) : data.kind === 'unavailable' ? (
        <p className={styles['note']}>— what this wallet holds could not be read just now.</p>
      ) : data.holdings.length === 0 ? (
        <p className={styles['note']}>{at} holds nothing Insidor can price yet.</p>
      ) : (
        <>
          <ul className={folio['list']} style={{ marginTop: 16 }}>
            {data.holdings.map((h) => <li key={h.address}><HoldingRow h={h} /></li>)}
          </ul>
          {data.notShown > 0 ? <p className={folio['foot']}>{data.notShown.toLocaleString('en-US')} more coins not shown.</p> : null}
          <p className={folio['foot']}>{GAINS_NOTE}</p>
        </>
      )}
    </section>
  );
}

/**
 * One's own "Show my trades to followers". Flipped at once and put back if the save fails, so the
 * switch never says something the server did not agree to.
 */
function ShareTrades({ on: saved }: { on: boolean }) {
  const toast = useToast();
  const [on, setOn] = useState(saved);
  const flip = async () => {
    const next = !on;
    setOn(next);
    try {
      await saveTradesPublic(next);
    } catch (e) {
      setOn(!next);
      toast("Couldn't save", e instanceof Error ? e.message : '');
    }
  };
  return (
    <button type="button" role="switch" aria-checked={on} className={styles['shareTrades']} onClick={() => void flip()}>
      <span>
        <b>Show my trades to followers</b>
        <small>{on ? 'Your buys and sells show in the Feed of people who follow you.' : 'Your buys and sells stay off the Feed. The chain itself is public either way.'}</small>
      </span>
      <span className={`${styles['toggle']} ${on ? styles['toggleOn'] : ''}`}>
        <i />
      </span>
    </button>
  );
}
