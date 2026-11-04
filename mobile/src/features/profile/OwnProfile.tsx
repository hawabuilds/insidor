/**
 * YOUR OWN PROFILE — the approved design's first screen: the head (ProfileParts.tsx) with share and
 * settings over the banner and a small "Edit profile" level with the picture; then your
 * portfolio (the total, its move this window and the purple chart), the stats strip, and your
 * Holdings and Created.
 *
 * Drawn on the Portfolio tab (features/portfolio/PortfolioScreen.tsx, which holds the wallet's kept
 * prices and the settings menu) and on #/u/<you> (ProfileScreen.tsx). Both hand in the wallet read
 * and the chart's points; this screen only lays them out and holds Edit profile.
 *
 * ★ WHO YOU ARE SHOWS AT ONCE. Until the social service's card is read, the head is drawn from the
 * sign-in (name, handle, picture) with your counts as dashes' worth of nothing; the card fills in the
 * banner, bio and counts. Edit profile opens only once the card is here, so it never saves over a
 * bio it has not read.
 *
 * What breaks if changed carelessly: the stats read the wallet's catches by address, the same
 * address the holdings were read for; a linked wallet's view must pass its own, or its rows would
 * carry another wallet's "Early" tags.
 */

import { useState, type ReactNode } from 'react';

import { fetchCatches, type Portfolio } from '../../shared/api/index.ts';
import type { ProfileCard } from '../../shared/api/people.ts';
import { useLoad } from '../../shared/hooks.ts';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { CheckIcon, CopyIcon } from '../../shared/ui/icons.tsx';
import { shortAddress } from '../portfolio/MenuSheets.tsx';
import type { BalancePoint } from '../portfolio/balance-points.ts';
import { EditProfileSheet } from './EditProfileSheet.tsx';
import { CoinLists, PortfolioBlock, ProfileHead, ShareGlyph, StatsStrip, shareProfile, type Who } from './ProfileParts.tsx';
import type { ProfileRange } from './profile-words.ts';
import styles from './profile.module.css';

export function OwnProfile({ who, card, reloadCard, address, data, total, asOf, rowsAsOf = null, points, range, onRange, over, below = null, back = false, now, signInName, onDeposit = null, editOpen, onEditOpen }: {
  /** What the sign-in knows, drawn until the card is read. */
  who: Who;
  card: ProfileCard | null;
  reloadCard: () => void;
  /** The wallet shown. */
  address: string;
  data: Portfolio | null;
  /** The total, drawn (with its kept-price steadying); null while read. */
  total: ReactNode | null;
  asOf: string | null;
  /** Rows shown from a last price, and when. */
  rowsAsOf?: ReadonlyMap<string, number> | null;
  points: readonly BalancePoint[] | null;
  range: ProfileRange;
  onRange: (r: ProfileRange) => void;
  /** The settings button (and anything else) over the banner, after Share. */
  over: ReactNode;
  /** Drawn under the portfolio: the wallet switcher and the linked-wallet notice. */
  below?: ReactNode;
  back?: boolean;
  now: number;
  signInName: string | null;
  /** Edit profile held by the caller, so the settings menu's pencil opens it here; else held here. */
  editOpen?: boolean;
  onEditOpen?: (open: boolean) => void;
  /** Opens Receive (your address and its QR code); null for a wallet you cannot act for. */
  onDeposit?: (() => void) | null;
}) {
  const toast = useToast();
  const [ownEditing, setOwnEditing] = useState(false);
  const editing = editOpen ?? ownEditing;
  const setEditing = onEditOpen ?? setOwnEditing;
  const [catches] = useLoad(`catches:${address}`, (signal) => fetchCatches(address, signal), 'memory');
  const shown: Who = card ?? who;
  const key = shown.handle ?? (card === null ? null : card.userId);
  const [copied, setCopied] = useState(false);
  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      /* ★ The copy icon turns to a green tick for a moment (the owner, 2026-11-04: option 1). */
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Couldn't copy", 'Your address is whole in Deposit.');
    }
  };
  const share = () => {
    if (key === null) return;
    void shareProfile(key, shown.name ?? `@${key}`).then((r) => {
      if (r === 'copied') toast('Link copied');
      if (r === 'failed') toast("Couldn't share", 'Try again in a moment.');
    });
  };
  return (
    <section className={styles['page']}>
      <ProfileHead
        who={shown}
        back={back}
        countsFor={card === null ? null : key}
        over={
          <>
            {key !== null ? (
              <button type="button" className={styles['glass']} aria-label="Share your profile" onClick={share}><ShareGlyph /></button>
            ) : null}
            {over}
          </>
        }
        /* Share is the banner's share button; Edit profile sits level with the picture, so the
           first screen reaches Holdings and Created (the owner, 2026-10-23). */
        beside={card !== null || onDeposit !== null ? (
          <div className={styles['besideRow']}>
            {card !== null ? <button type="button" className={styles['editSmall']} onClick={() => setEditing(true)}>Edit profile</button> : null}
            {onDeposit !== null ? <button type="button" className={styles['deposit']} onClick={onDeposit}>Deposit</button> : null}
          </div>
        ) : null}
        /* ★ Your wallet address beside your handle, and Deposit at the right (the owner, 2026-11-04). */
        besideHandle={onDeposit !== null ? (
          <button type="button" className={styles['addressChip']} aria-label={copied ? 'Address copied' : 'Copy your wallet address'} onClick={() => void copyAddress()}>
            {shortAddress(address)}{copied ? <span className={styles['copiedTick']}><CheckIcon size={12} /></span> : <CopyIcon size={12} />}
          </button>
        ) : null}
        actions={null}
      />
      <PortfolioBlock total={total} asOf={asOf} points={points} range={range} onRange={onRange} />
      {below}
      <StatsStrip catches={catches.state === 'ready' ? catches.value : catches.state === 'failed' ? { kind: 'unavailable' } : null} state="shown" />
      <CoinLists data={data} catches={catches.state === 'ready' ? catches.value : null} self at={shown.handle !== null ? `@${shown.handle}` : 'You'} now={now} asOf={rowsAsOf} />
      {editing && card !== null ? <EditProfileSheet card={card} signInName={signInName} onClose={() => setEditing(false)} onSaved={reloadCard} /> : null}
    </section>
  );
}
