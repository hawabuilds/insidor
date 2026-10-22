/**
 * A PERSON'S PROFILE, #/u/<handle> — the approved design (direction B, the owner, 2026-10-22).
 *
 * Someone else's: their banner, picture, name with the X button, @handle, bio and counts, the
 * followers you have in common ("Followed by @a and 4 others", with their pictures), Follow (or
 * Follow back, or Following) and Share, the ⋯ menu, then their stats strip and their Holdings and
 * Created. No portfolio total and no chart: what someone holds is listed, what it adds up to is
 * theirs. Your own, reached here from a link: the same screen as your Portfolio tab
 * (features/profile/OwnProfile.tsx), with a back button.
 *
 * ★ A HIDDEN PORTFOLIO IS SAID, NOT DRAWN EMPTY. The social service withholds the wallet unless
 * "Show my trades" is on (one switch for the Feed and the profile); turned off, the strip's cells
 * say "Hidden" and the lists say "Hidden by @handle". No wallet address is shown: the rows are the
 * facts.
 *
 * ★ A PERSON'S OWN NUMBERS ONLY. Counts, mutuals and catches are about this person's own wallet and
 * follows; nothing on this screen rates a coin or a post.
 *
 * What breaks if changed carelessly: Follow is optimistic and rolls back on a refusal, and the
 * counts move with it; the button's state comes from profile-words.ts followButton, which the tests
 * hold, never from a label typed here.
 */

import { useState } from 'react';

import { fetchCatches, fetchPortfolio, fetchWalletHistory } from '../../shared/api/index.ts';
import { follow, fetchProfile, type ProfileCard } from '../../shared/api/people.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { hrefFor } from '../../shared/route.ts';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { GearIcon } from '../../shared/ui/icons.tsx';
import { withLive } from '../portfolio/balance-points.ts';
import { OwnProfile } from '../profile/OwnProfile.tsx';
import { CoinLists, HeadSkeleton, MoreGlyph, ProfileHead, ShareGlyph, StatsStrip, shareProfile } from '../profile/ProfileParts.tsx';
import { followButton, totalWords, type ProfileRange } from '../profile/profile-words.ts';
import styles from '../profile/profile.module.css';

export function ProfileScreen({ profileKey }: { profileKey: string }) {
  const [loaded, reload] = useLoad(`profile:${profileKey}`, () => fetchProfile(profileKey), 'memory');
  if (loaded.state === 'loading') return <section className={styles['page']}><HeadSkeleton back /></section>;
  if (loaded.state === 'failed') {
    return (
      <section className={styles['page']}>
        <HeadSkeleton back />
        <p className={styles['note']}>No account @{profileKey}. Nobody has claimed this handle here yet, or it could not be read just now.</p>
      </section>
    );
  }
  const p = loaded.value.profile;
  return p.isMe && p.wallet !== null ? <Mine key={p.userId} p={p} reload={reload} /> : <Theirs key={p.userId} p={p} />;
}

/** Your own profile reached by its link: your wallet read here, as the Portfolio tab reads it. */
function Mine({ p, reload }: { p: ProfileCard; reload: () => void }) {
  const wallet = p.wallet!;
  const now = useNow();
  const [range, setRange] = useState<ProfileRange>('1w');
  const [data] = useLoad(`wallet:${wallet}`, (signal) => fetchPortfolio(wallet, '24h', signal), 'memory');
  const [stored] = useLoad(`wallet-history:${wallet}:${range}`, (signal) => fetchWalletHistory(wallet, range, signal), 'memory');
  const read = data.state === 'ready' ? data.value : data.state === 'failed' ? ({ kind: 'unavailable' } as const) : null;
  const live = read?.kind === 'read' && read.totalUsd.known ? read.totalUsd.amount : null;
  const points = stored.state === 'loading' ? null : withLive(stored.state === 'ready' ? stored.value : [], live, Date.now());
  return (
    <OwnProfile
      who={p}
      card={p}
      reloadCard={reload}
      address={wallet}
      data={read}
      total={read?.kind === 'read' ? totalWords(read.totalUsd) : null}
      asOf={null}
      points={points}
      range={range}
      onRange={setRange}
      over={<a className={styles['glass']} href={hrefFor({ screen: 'portfolio' })} aria-label="Settings, on your Portfolio tab"><GearIcon size={19} /></a>}
      back
      now={now}
      signInName={null}
    />
  );
}

/** Someone else's profile. */
function Theirs({ p }: { p: ProfileCard }) {
  const toast = useToast();
  const now = useNow();
  const [iFollow, setIFollow] = useState(p.iFollow);
  const [followers, setFollowers] = useState(p.followers);
  const [menu, setMenu] = useState(false);
  const key = p.handle ?? p.userId;
  const at = p.handle !== null ? `@${p.handle}` : (p.name ?? 'This person');
  const button = followButton({ isMe: p.isMe, iFollow, followsMe: p.followsMe });
  const shownWallet = p.portfolio === 'shown' ? p.wallet : null;
  const state = p.portfolio === 'private' ? 'hidden' : p.portfolio === 'no_wallet' ? 'no_wallet' : 'shown';
  const [data] = useLoad(`wallet:${shownWallet ?? 'none'}`, (signal) => (shownWallet === null ? Promise.resolve(null) : fetchPortfolio(shownWallet, '24h', signal)), 'memory');
  const [catches] = useLoad(`catches:${shownWallet ?? 'none'}`, (signal) => (shownWallet === null ? Promise.resolve(null) : fetchCatches(shownWallet, signal)), 'memory');

  const toggleFollow = async () => {
    const next = !iFollow;
    setIFollow(next);
    setFollowers((n) => n + (next ? 1 : -1));
    try {
      await follow(p.userId, next);
    } catch (e) {
      setIFollow(!next);
      setFollowers((n) => n + (next ? -1 : 1));
      toast("Couldn't update that follow", e instanceof Error ? e.message : '');
    }
  };
  const share = () => {
    setMenu(false);
    void shareProfile(key, p.name ?? at).then((r) => {
      if (r === 'copied') toast('Link copied');
      if (r === 'failed') toast("Couldn't share", 'Try again in a moment.');
    });
  };
  const copyLink = () => {
    setMenu(false);
    void navigator.clipboard.writeText(`${location.origin}${location.pathname}#/u/${encodeURIComponent(key)}`).then(() => toast('Link copied'), () => toast("Couldn't copy the link"));
  };

  return (
    <section className={styles['page']}>
      <ProfileHead
        who={{ ...p, followers }}
        back
        countsFor={key}
        over={<button type="button" className={styles['glass']} aria-label={`Share ${at}'s profile`} onClick={share}><ShareGlyph /></button>}
        actions={
          <>
            {button !== null ? (
              <button type="button" className={button.solid ? styles['solid'] : styles['outline']} onClick={() => void toggleFollow()}>{button.label}</button>
            ) : null}
            <button type="button" className={styles['outline']} onClick={share}>Share</button>
            <div className={styles['menuWrap']}>
              <button type="button" className={`${styles['outline']} ${styles['more']}`} aria-label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><MoreGlyph /></button>
              {menu ? (
                <div className={styles['menu']} role="menu">
                  <button type="button" role="menuitem" onClick={share}>Share profile</button>
                  <button type="button" role="menuitem" onClick={copyLink}>Copy profile link</button>
                </div>
              ) : null}
            </div>
          </>
        }
      />
      <StatsStrip catches={catches.state === 'ready' ? catches.value : catches.state === 'failed' ? { kind: 'unavailable' } : null} state={state} />
      <CoinLists
        data={state !== 'shown' ? null : data.state === 'ready' ? data.value : data.state === 'failed' ? { kind: 'unavailable' } : null}
        catches={catches.state === 'ready' ? catches.value : null}
        self={false}
        at={at}
        hidden={state === 'hidden'}
        noWallet={state === 'no_wallet'}
        now={now}
      />
    </section>
  );
}
