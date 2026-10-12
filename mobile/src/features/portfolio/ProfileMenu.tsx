/**
 * THE PROFILE MENU — Trador's settings menu (`SettingsMenu.tsx`), top right of the Portfolio tab: a
 * gear that opens a small panel anchored under it, closed by a tap outside or Escape.
 *
 * What it holds, row by row against Trador's:
 *
 *   who you are            kept: the name, and the @handle for X; for Google the name and
 *                          "Signed in", as Trador says it — a Google email is never shown
 *   the wallet card        kept: "Your Insidor wallet", the address, copy, and a chain explorer
 *   export private key     kept: the wallet provider's own secure window; the key is drawn on the
 *                          provider's domain and never reaches our code (wallet port, showKeyExport)
 *   import a wallet        kept (#/import): a warning, then the key from a box straight into the
 *                          provider's SDK (@insidor/wallet-embedded KeyImport), never our servers
 *   link a wallet          ours (#/wallets): Phantom joined through the provider's window, view only
 *   notifications          kept: the alert settings (#/alerts/settings)
 *   leaderboard, profile   ours: the season's ranks, and your own profile
 *   learn the basics       kept, as How Insidor works (#/learn)
 *   referrals, public page not ported: Insidor has neither
 *   sign out               kept, in red; it returns to the front door (shared/sign-in.ts)
 *
 * In the demo build (no sign-in) the header says "Sample wallet" and the last row leaves the demo
 * for the front door instead of signing out of an account nobody signed in to.
 *
 * What breaks if changed carelessly: the outside-tap listener is on `pointerdown`, not `click`,
 * so the tap that closes the menu is not also a tap on whatever is under it.
 */

import { useEffect, useRef, useState } from 'react';

import { hrefFor } from '../../shared/route.ts';
import { BellIcon, CapIcon, CopyIcon, ExternalIcon, GearIcon, LockIcon, LogoutIcon, TrophyIcon, UserIcon, WalletIcon } from '../../shared/ui/icons.tsx';
import styles from './profile-menu.module.css';

/** "86xCnP…2MMY": six and four, as Trador's wallet card shows it. */
const shortAddress = (a: string): string => (a.length <= 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`);

export function ProfileMenu({ name, subtitle, address, onCopy, exportKey, profileKey, linked, leave }: {
  name: string;
  /** "@handle", "Signed in", or "Sample data". */
  subtitle: string;
  address: string;
  onCopy: () => void;
  /** Opens the provider's key export window; null where there is no wallet of one's own (the demo), which also titles the card as a sample. */
  exportKey: (() => void) | null;
  /** This person's profile (handle or id); null in the demo. */
  profileKey: string | null;
  /** Outside wallets joined for viewing. */
  linked: readonly string[];
  /** Sign out, or in the demo leave it; the label says which. */
  leave: { readonly label: string; readonly run: () => void };
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={root} className={styles['root']}>
      <button type="button" className={`${styles['gear']} ${open ? styles['gearOn'] : ''}`} aria-label="Profile and settings" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <GearIcon size={19} />
      </button>

      {open ? (
        <div className={styles['panel']} role="menu" aria-label="Profile and settings">
          <div className={styles['head']}>
            <b>{name}</b>
            <span>{subtitle}</span>
          </div>

          <div className={styles['card']}>
            {/* The demo's wallet is a stranger's, recorded: never called yours, never Active. */}
            {exportKey !== null ? (
              <>
                <div className={styles['cardTitle']}>
                  Your Insidor wallet <span className={styles['active']}>Active</span>
                </div>
                <p>Holds what you buy here, and is what your portfolio counts.</p>
              </>
            ) : (
              <>
                <div className={styles['cardTitle']}>Sample wallet</div>
                <p>A public wallet, recorded to show this screen. Not yours, and nothing here trades from it.</p>
              </>
            )}
            <div className={styles['address']}>
              <span>{shortAddress(address)}</span>
              <button type="button" aria-label="Copy wallet address" onClick={onCopy}><CopyIcon size={14} /></button>
              <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noreferrer" aria-label="Open the wallet on Solscan"><ExternalIcon size={14} /></a>
            </div>
          </div>

          {linked.map((l) => (
            <div key={l} className={styles['card']}>
              <div className={styles['cardTitle']}>Linked wallet</div>
              <p>View only: Insidor reads it from the chain and never holds its key.</p>
              <div className={styles['address']}>
                <span>{shortAddress(l)}</span>
                <a href={`https://solscan.io/account/${l}`} target="_blank" rel="noreferrer" aria-label="Open the linked wallet on Solscan"><ExternalIcon size={14} /></a>
              </div>
            </div>
          ))}

          {profileKey !== null ? (
            <a className={styles['row']} role="menuitem" href={hrefFor({ screen: 'profile', key: profileKey })} onClick={() => setOpen(false)}>
              <UserIcon size={16} /> Your profile
            </a>
          ) : null}
          {exportKey !== null ? (
            <button
              type="button"
              role="menuitem"
              className={styles['row']}
              onClick={() => {
                setOpen(false);
                exportKey();
              }}
            >
              <LockIcon size={16} /> Export private key
            </button>
          ) : null}
          <a className={styles['row']} role="menuitem" href={hrefFor({ screen: 'import' })} onClick={() => setOpen(false)}>
            <WalletIcon size={16} /> Import a wallet
          </a>
          <a className={styles['row']} role="menuitem" href={hrefFor({ screen: 'wallets' })} onClick={() => setOpen(false)}>
            <WalletIcon size={16} /> Link a wallet to view
          </a>
          <a className={styles['row']} role="menuitem" href={hrefFor({ screen: 'alert-settings' })} onClick={() => setOpen(false)}>
            <BellIcon size={16} /> Notifications
          </a>
          <a className={styles['row']} role="menuitem" href={hrefFor({ screen: 'leaderboard' })} onClick={() => setOpen(false)}>
            <TrophyIcon size={16} /> Leaderboard
          </a>
          <a className={styles['row']} role="menuitem" href={hrefFor({ screen: 'learn' })} onClick={() => setOpen(false)}>
            <CapIcon size={16} /> How Insidor works
          </a>
          <button
            type="button"
            role="menuitem"
            className={`${styles['row']} ${styles['leave']}`}
            onClick={() => {
              setOpen(false);
              leave.run();
            }}
          >
            <LogoutIcon size={16} /> {leave.label}
          </button>
        </div>
      ) : null}
    </div>
  );
}
