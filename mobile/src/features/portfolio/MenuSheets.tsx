/**
 * THE PROFILE MENU'S TWO HOLDING SHEETS, behind its Wallets and Settings rows (ProfileMenu.tsx):
 * what the long menu showed row by row, grouped so the menu itself stays one short panel, as
 * Trador's does.
 *
 *   Wallets    Export private key (the provider's own secure window: the key is drawn on the
 *              provider's page and never reaches our code), Import a wallet (#/import, straight
 *              into the provider's SDK), Link a wallet to view (#/wallets), and the linked wallets
 *   Settings   Show my trades to followers (one switch for the Feed and the portfolio, read when
 *              opened, put back if the save fails), and Notifications (#/feed/settings)
 *
 * What breaks if changed carelessly: Export stays a call to the wallet port's `showKeyExport`. Our
 * code never sees, stores, logs or carries a private key, and nothing in these sheets may ask for one.
 */

import { useEffect, useState } from 'react';

import { saveTradesPublic } from '../../shared/api/following.ts';
import { fetchMe } from '../../shared/api/people.ts';
import { hrefFor } from '../../shared/route.ts';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { BellIcon, ChevronIcon, ExternalIcon, LockIcon, UserIcon, WalletIcon } from '../../shared/ui/icons.tsx';
import { Sheet, SheetBody, SheetHead } from '../../shared/ui/Sheet.tsx';
import styles from './profile-menu.module.css';

/**
 * Runs `then` once the sheet's own history entry is gone (shared/ui/dismiss.ts takes it back off when a
 * sheet closes). The provider's export window closes itself on a history change, and on a phone the
 * sheet's step back landed just after the window opened, so it vanished at once (the owner,
 * 2026-10-24: "on mobile no pop up appears, but it works on desktop"). After the step, or at most
 * `wait` ms if none comes.
 */
function afterSheetClosed(then: () => void, wait = 700): void {
  let done = false;
  const go = (): void => {
    if (done) return;
    done = true;
    window.removeEventListener('popstate', step);
    window.setTimeout(then, 60);
  };
  const step = (): void => go();
  window.addEventListener('popstate', step);
  window.setTimeout(go, wait);
}

/** "86xCnP…2MMY": six and four, as Trador's wallet card shows it. */
export const shortAddress = (a: string): string => (a.length <= 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`);

export function WalletsSheet({ onClose, exportKey, linked }: { readonly onClose: () => void; readonly exportKey: (() => void) | null; readonly linked: readonly string[] }) {
  return (
    <Sheet label="Wallets" onClose={onClose} fit>
      <SheetHead title="Wallets" />
      <SheetBody last>
        <div className={styles['sheetBody']}>
          {exportKey !== null ? (
            <button
              type="button"
              className={styles['sheetRow']}
              onClick={() => {
                onClose();
                afterSheetClosed(exportKey);
              }}
            >
              <LockIcon size={16} /> <span>Export private key</span> <ChevronIcon size={14} />
            </button>
          ) : null}
          <a className={styles['sheetRow']} href={hrefFor({ screen: 'import' })} onClick={onClose}>
            <WalletIcon size={16} /> <span>Import a wallet</span> <ChevronIcon size={14} />
          </a>
          <a className={styles['sheetRow']} href={hrefFor({ screen: 'wallets' })} onClick={onClose}>
            <WalletIcon size={16} /> <span>Link a wallet to view</span> <ChevronIcon size={14} />
          </a>
          {linked.length > 0 ? <h3 className={styles['sheetSection']}>Linked wallets</h3> : null}
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
        </div>
      </SheetBody>
    </Sheet>
  );
}

export function SettingsSheet({ onClose, member }: { readonly onClose: () => void; readonly member: boolean }) {
  return (
    <Sheet label="Settings" onClose={onClose} fit>
      <SheetHead title="Settings" />
      <SheetBody last>
        <div className={styles['sheetBody']}>
          {member ? <ShareTrades /> : null}
          <a className={styles['sheetRow']} href={hrefFor({ screen: 'alert-settings' })} onClick={onClose}>
            <BellIcon size={16} /> <span>Notifications</span> <ChevronIcon size={14} />
          </a>
        </div>
      </SheetBody>
    </Sheet>
  );
}

/**
 * "Show my trades to followers" as a toggle row. Its state is read from your profile when the sheet
 * opens; until then the switch is drawn neither on nor off, and a read that fails says so rather
 * than guessing. Flipped at once and put back if the save fails, so the switch never says
 * something the server did not agree to.
 */
function ShareTrades() {
  const toast = useToast();
  const [on, setOn] = useState<boolean | 'loading' | 'unread'>('loading');
  useEffect(() => {
    let live = true;
    fetchMe().then(
      (me) => live && setOn(typeof me.tradesPublic === 'boolean' ? me.tradesPublic : 'unread'),
      () => live && setOn('unread'),
    );
    return () => {
      live = false;
    };
  }, []);
  const flip = async () => {
    if (typeof on !== 'boolean') return;
    const next = !on;
    setOn(next);
    try {
      await saveTradesPublic(next);
    } catch (e) {
      setOn(!next);
      toast("Couldn't save", e instanceof Error ? e.message : '');
    }
  };
  const known = typeof on === 'boolean';
  return (
    <button type="button" role="switch" aria-checked={known ? on : 'mixed'} className={`${styles['sheetRow']} ${styles['switchRow']}`} onClick={() => void flip()}>
      <UserIcon size={16} />
      <span className={styles['switchText']}>
        <b>Show my trades to followers</b>
        <small>
          {on === 'loading' ? '—' : on === 'unread' ? "— couldn't be read just now" : on ? 'Your trades and portfolio show to others' : 'Hidden from others, your portfolio included'}
        </small>
      </span>
      <span className={`${styles['toggle']} ${on === true ? styles['toggleOn'] : ''} ${known ? '' : styles['toggleUnknown']}`}><i /></span>
    </button>
  );
}
