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
 *   import a wallet        NOT PORTED: the provider's only import takes the key from our code
 *   notifications          not yet: there are none to set until they are built
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
import { CapIcon, CopyIcon, ExternalIcon, GearIcon, LockIcon, LogoutIcon } from '../../shared/ui/icons.tsx';
import styles from './profile-menu.module.css';

/** "86xCnP…2MMY": six and four, as Trador's wallet card shows it. */
const shortAddress = (a: string): string => (a.length <= 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`);

export function ProfileMenu({ name, subtitle, address, onCopy, exportKey, leave }: {
  name: string;
  /** "@handle", "Signed in", or "Sample data". */
  subtitle: string;
  address: string;
  onCopy: () => void;
  /** Opens the provider's key export window; null where there is no wallet of one's own (the demo). */
  exportKey: (() => void) | null;
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
            <div className={styles['cardTitle']}>
              Your Insidor wallet <span className={styles['active']}>Active</span>
            </div>
            <p>Holds what you buy here, and is what your portfolio counts.</p>
            <div className={styles['address']}>
              <span>{shortAddress(address)}</span>
              <button type="button" aria-label="Copy wallet address" onClick={onCopy}><CopyIcon size={14} /></button>
              <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noreferrer" aria-label="Open the wallet on Solscan"><ExternalIcon size={14} /></a>
            </div>
          </div>

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
