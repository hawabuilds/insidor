/**
 * THE PROFILE MENU — Trador's settings menu (`SettingsMenu.tsx`), condensed as Trador's is (the
 * owner, 2026-10-21): top right of the Portfolio tab, a gear that opens a 286px panel anchored under
 * it, closed by a tap outside or Escape. One short panel, one row per thing; what used to be a
 * row each now sits in the sheet its row opens (menu-rows.ts lists it all, and its test holds that
 * nothing was removed, only grouped).
 *
 *   header           your picture, name and @handle; a tap opens your profile, the pencil edits it
 *   the wallet card  "Your Insidor wallet", the green Active pill, the address, copy and Solscan
 *   Wallets          a sheet: Export private key, Import a wallet, Link a wallet to view, the linked
 *                    wallets (MenuSheets.tsx). The key is only ever shown in the wallet provider's
 *                    own window; our code never sees, stores or logs one
 *   Invites          the green "N joined" pill; a sheet of my codes and who joined with them
 *                    (features/invites/InvitesSheet.tsx)
 *   Settings         a sheet: Show my trades to followers, Notifications
 *   Leaderboard, How Insidor works   links, as before
 *   Owner tools      the owner only: Add missed posts, the invite numbers and controls
 *   Sign out         in red; it returns to the front door (shared/sign-in.ts)
 *
 * Every sheet is drawn outside the panel, so closing the menu does not close what it opened.
 *
 * What breaks if changed carelessly: the outside-tap listener is on `pointerdown`, not `click`,
 * so the tap that closes the menu is not also a tap on whatever is under it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchMyInvites } from '../../shared/api/invites.ts';
import { hrefFor } from '../../shared/route.ts';
import { CapIcon, ChevronIcon, CopyIcon, ExternalIcon, GearIcon, LogoutIcon, PlusIcon, TrophyIcon, WalletIcon } from '../../shared/ui/icons.tsx';
import { InvitesSheet } from '../invites/InvitesSheet.tsx';
import { OwnerToolsSheet } from '../invites/OwnerTools.tsx';
import { MissedPostsSheet } from '../missed/MissedPosts.tsx';
import { useIsOwner } from '../owner/hooks.ts';
import { Avatar } from './Avatar.tsx';
import { SettingsSheet, WalletsSheet, shortAddress } from './MenuSheets.tsx';
import { joinedPill, menuRows, type MenuRow } from './menu-rows.ts';
import styles from './profile-menu.module.css';

type Open = 'wallets' | 'invites' | 'settings' | 'owner' | 'missed' | null;

export function ProfileMenu({ name, handle, pictureUrl, address, onCopy, exportKey, profileKey, linked, leave }: {
  name: string;
  /** The X handle without "@"; null for a sign-in without one. */
  handle: string | null;
  /** Your X picture; null draws your initial. */
  pictureUrl: string | null;
  address: string;
  onCopy: () => void;
  /** Opens the provider's key export window; null where there is none to open. */
  exportKey: (() => void) | null;
  /** This person's profile (handle or id); null in the demo or while a session comes back. */
  profileKey: string | null;
  /** Outside wallets joined for viewing. */
  linked: readonly string[];
  /** Sign out, or in the demo leave it; the label says which. */
  leave: { readonly label: string; readonly run: () => void };
}) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<Open>(null);
  const [joined, setJoined] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const owner = useIsOwner();
  const root = useRef<HTMLDivElement>(null);
  const member = profileKey !== null;

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (root.current !== null && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  /* The Invites row's "N joined", read each time the menu opens; nothing is drawn until it is. */
  useEffect(() => {
    if (!open || !member) return;
    let live = true;
    fetchMyInvites().then((m) => live && setJoined(m.joined.length), () => undefined);
    return () => {
      live = false;
    };
  }, [open, member]);
  const onRead = useCallback((n: number) => setJoined(n), []);

  const then = (next: Open) => () => {
    setOpen(false);
    setSheet(next);
  };
  const copy = () => {
    onCopy();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  };
  const pill = joinedPill(joined);

  const row = (r: MenuRow) => {
    switch (r) {
      case 'wallets':
        return <Row key={r} icon={<WalletIcon size={16} />} label="Wallets" onClick={then('wallets')} more />;
      case 'invites':
        return <Row key={r} icon={<InvitesIcon />} label="Invites" onClick={then('invites')} more pill={pill} />;
      case 'settings':
        return <Row key={r} icon={<GearIcon size={16} />} label="Settings" onClick={then('settings')} more />;
      case 'leaderboard':
        return (
          <a key={r} className={styles['row']} role="menuitem" href={hrefFor({ screen: 'leaderboard' })} onClick={() => setOpen(false)}>
            <TrophyIcon size={16} /> <span className={styles['rowLabel']}>Leaderboard</span>
          </a>
        );
      case 'learn':
        return (
          <a key={r} className={styles['row']} role="menuitem" href={hrefFor({ screen: 'learn' })} onClick={() => setOpen(false)}>
            <CapIcon size={16} /> <span className={styles['rowLabel']}>How Insidor works</span>
          </a>
        );
      case 'owner':
        return <Row key={r} icon={<PlusIcon size={16} />} label="Owner tools" onClick={then('owner')} more />;
      case 'leave':
        return (
          <button
            key={r}
            type="button"
            role="menuitem"
            className={`${styles['row']} ${styles['leave']}`}
            onClick={() => {
              setOpen(false);
              leave.run();
            }}
          >
            <LogoutIcon size={16} /> <span className={styles['rowLabel']}>{leave.label}</span>
          </button>
        );
    }
  };

  return (
    <div ref={root} className={styles['root']}>
      <button type="button" className={`${styles['gear']} ${open ? styles['gearOn'] : ''}`} aria-label="Profile and settings" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <GearIcon size={19} />
      </button>

      {open ? (
        <div className={styles['panel']} role="menu" aria-label="Profile and settings">
          <div className={styles['head']}>
            {member ? (
              <a className={styles['who']} href={hrefFor({ screen: 'profile', key: profileKey })} onClick={() => setOpen(false)} aria-label="Your profile">
                <Avatar name={name} seed={handle ?? address} src={pictureUrl} size={36} />
                <span className={styles['whoText']}>
                  <b>{name}</b>
                  <span>{handle !== null ? `@${handle}` : 'Signed in'}</span>
                </span>
              </a>
            ) : (
              <span className={styles['who']}>
                <Avatar name={name} seed={handle ?? address} src={pictureUrl} size={36} />
                <span className={styles['whoText']}>
                  <b>{name}</b>
                  <span>{handle !== null ? `@${handle}` : 'Signed in'}</span>
                </span>
              </span>
            )}
            {member ? (
              <a className={styles['edit']} href={hrefFor({ screen: 'profile', key: profileKey })} onClick={() => setOpen(false)} aria-label="Edit profile">
                <PenIcon />
              </a>
            ) : null}
          </div>

          <div className={styles['card']}>
            <div className={styles['cardTitle']}>
              Your Insidor wallet <span className={styles['active']}>Active</span>
            </div>
            <p>Holds what you buy here, and is what your portfolio counts.</p>
            <div className={styles['address']}>
              <span>{copied ? 'Copied' : shortAddress(address)}</span>
              <button type="button" aria-label="Copy wallet address" onClick={copy}><CopyIcon size={14} /></button>
              <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noreferrer" aria-label="Open the wallet on Solscan"><ExternalIcon size={14} /></a>
            </div>
          </div>

          <div className={styles['rows']}>{menuRows({ owner, member, canExport: exportKey !== null }).map(row)}</div>
        </div>
      ) : null}
      {sheet === 'wallets' ? <WalletsSheet onClose={() => setSheet(null)} exportKey={exportKey} linked={linked} /> : null}
      {sheet === 'invites' ? <InvitesSheet onClose={() => setSheet(null)} onRead={onRead} /> : null}
      {sheet === 'settings' ? <SettingsSheet onClose={() => setSheet(null)} member={member} /> : null}
      {sheet === 'owner' ? <OwnerToolsSheet onClose={() => setSheet(null)} onMissed={() => setSheet('missed')} /> : null}
      {sheet === 'missed' ? <MissedPostsSheet onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

function Row({ icon, label, onClick, more = false, pill = null }: { icon: React.ReactNode; label: string; onClick: () => void; more?: boolean; pill?: string | null }) {
  return (
    <button type="button" role="menuitem" className={styles['row']} onClick={onClick}>
      {icon} <span className={styles['rowLabel']}>{label}</span>
      {pill !== null ? <span className={styles['active']}>{pill}</span> : null}
      {more ? <span className={styles['more']}><ChevronIcon size={14} /></span> : null}
    </button>
  );
}

function PenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function InvitesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  );
}
