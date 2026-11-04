/**
 * THE PORTFOLIO TAB — your own profile (features/profile/OwnProfile.tsx, the owner's approved
 * design of 2026-10-22): who you are over your banner, what your wallet holds and what it is worth,
 * your catches, Holdings and Created. Over the banner, Share and the settings gear (ProfileMenu.tsx,
 * whose wallet card opens Receive: the address and its QR code), and Send in a trading build.
 *
 * This file holds the wallet's reads: the signed-in wallet or a linked one, each read's prices kept
 * on the phone so a worth never blanks (wallet-view.ts steadyWallet), the chart's points with the
 * live total last, and the last wallet remembered so the tab opens at once while a session returns.
 *
 * ★ NOBODY SIGNS IN HERE. The front door is the only sign-in (shared/sign-in.ts gates the whole
 * app), so this tab is only ever reached signed in. Signing out is in the profile menu, and
 * returns to the door. A build with no sign-in shows "Sign in to see your portfolio" — never a
 * stand-in wallet.
 *
 * Sign-in creates a Solana wallet for anyone who has none (the vendor holds it; we never see a
 * key). The tab reads the signed-in person's own wallet, or one they linked to view.
 *
 * ★ SEND ONLY WITH TRADING ON. Receive is always there (it is an address); Send appears only in a
 * build with TRADING on, never as a disabled button.
 */

import { NotificationBell } from '../../shared/ui/NotificationBell.tsx';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { fetchPortfolio, fetchWalletHistory, type Holding, type Portfolio as PortfolioData } from '../../shared/api/index.ts';
import { fetchMe } from '../../shared/api/people.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { keep, kept } from '../../shared/kept-reads.ts';
import { LINKED_WALLET } from '../../shared/notice.ts';
import { tradingOn } from '../../shared/trading.ts';
import { Notice } from '../../shared/ui/Notice.tsx';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { SIGN_IN_CONFIGURED } from '../../shared/sign-in.ts';
import { useWallet } from '../../shared/wallet.tsx';
import { forgetEntered } from '../landing/entered.ts';
import { OwnProfile } from '../profile/OwnProfile.tsx';
import { totalWords, type ProfileRange } from '../profile/profile-words.ts';
import profile from '../profile/profile.module.css';
import { ProfileMenu } from './ProfileMenu.tsx';
import { withLive, type BalancePoint } from './balance-points.ts';
import { asOfWords, notePrices, steadyWallet, type LastPrices, type SteadyWallet } from './wallet-view.ts';
import { ReceiveSheet } from './ReceiveSheet.tsx';
import { SendSheet } from './SendSheet.tsx';
import box from './wallet.module.css';

/** Who the tab is for: the signed-in person, or a linked wallet being viewed. */
interface WhoAmI {
  readonly name: string | null;
  readonly handle: string | null;
  readonly pictureUrl: string | null;
  readonly address: string;
}

/* Read once, at build time, like the trade bar: a deploy turns Send on, never a page. */
const TRADING = tradingOn({ VITE_TRADING: import.meta.env?.['VITE_TRADING'] as string | undefined });

function Loaded({ who, load, history, canAct, ownAddress, exportKey, profileKey = null, linked = [], switcher = null, leave }: {
  who: WhoAmI;
  load: (signal: AbortSignal) => Promise<PortfolioData>;
  history: (signal: AbortSignal, range: ProfileRange) => Promise<readonly BalancePoint[]>;
  canAct: boolean;
  exportKey: (() => void) | null;
  /** The signed-in person's own wallet, for the menu's card, whichever wallet is shown. */
  ownAddress?: string;
  profileKey?: string | null;
  linked?: readonly string[];
  /** The strip that picks which wallet is shown, when there is more than one. */
  switcher?: React.ReactNode;
  leave: { readonly label: string; readonly run: () => void };
}) {
  const [range, setRange] = useState<ProfileRange>('1w');
  const [sheet, setSheet] = useState<'send' | 'receive' | null>(null);
  const [editing, setEditing] = useState(false);
  const [data] = useLoad(`wallet:${who.address}`, (signal) => load(signal), 'phone');
  const [stored] = useLoad(`wallet-history:${who.address}:${range}`, (signal) => history(signal, range), 'memory');
  /* Your profile card (banner, bio, counts): for you, not for a linked wallet's view. */
  /* Read whenever you are signed in, not only when the sign-in carries an X handle: an email or Google
     member has no handle there, and their chosen username and sign-up photo live only on this card. */
  const meKey = canAct ? (ownAddress ?? who.address) : profileKey;
  const [card, reloadCard] = useLoad(`me:${meKey ?? 'none'}`, () => (meKey === null ? Promise.resolve(null) : fetchMe()), 'memory');
  const now = useNow();
  const read: PortfolioData | null = data.state === 'ready' ? data.value : data.state === 'failed' ? { kind: 'unavailable' } : null;
  /* Each fresh read's prices are kept on the phone, and the last read with a total too, so a read
     that lacks a price — or fails outright — shows the last known dollars with their age. */
  const freshRead = data.state === 'ready' && data.stale !== true ? data.value : null;
  useEffect(() => {
    if (freshRead === null || freshRead.kind !== 'read') return;
    keep(pricesKey(who.address), notePrices(kept<LastPrices>(pricesKey(who.address))?.value ?? null, freshRead, Date.now()), true);
    if (freshRead.totalUsd.known) keep(lastReadKey(who.address), freshRead, true);
  }, [freshRead, who.address]);
  const shown = shownWallet(read, data.state === 'ready' && data.stale === true, who.address, now);
  const portfolio: PortfolioData | null = shown?.data ?? read;
  const live = portfolio?.kind === 'read' && portfolio.totalUsd.known ? portfolio.totalUsd.amount : null;
  const points = stored.state === 'loading' ? null : withLive(stored.state === 'ready' ? stored.value : [], live, Date.now());
  const holdings: readonly Holding[] = portfolio?.kind === 'read' ? portfolio.holdings : [];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(who.address);
    } catch {
      /* The menu's copy is a convenience; the address is also whole in Receive. */
    }
  };

  const myCard = canAct && card.state === 'ready' ? card.value : null;
  /* Over the banner, before the gear: Send in a trading build. Receive is in the gear's wallet card. */
  const over = (
    <>
      {canAct && TRADING ? <button type="button" className={profile['glass']} aria-label="Send" onClick={() => setSheet('send')}><Arrow up /></button> : null}
      <NotificationBell className={profile['glass']} />
      <ProfileMenu
        /* ★ Your profile as you set it (the card), not the sign-in's: the menu showed your old
           name and picture beside the new ones (the owner, 2026-11-04). */
        name={myCard?.name ?? who.name ?? who.handle ?? 'Your wallet'}
        handle={myCard?.handle ?? who.handle}
        pictureUrl={myCard?.pictureUrl ?? who.pictureUrl}
        pictureFile={myCard?.pictureFile ?? null}
        onEdit={myCard !== null ? () => setEditing(true) : null}
        address={ownAddress ?? who.address}
        onCopy={() => void copy()}
        exportKey={exportKey}
        profileKey={(card.state === 'ready' ? card.value?.handle : null) ?? profileKey}
        linked={linked}
        leave={leave}
        onBanner
        onReceive={canAct ? () => setSheet('receive') : null}
      />
    </>
  );
  const totalAsOf = shown?.asOf.total ?? null;
  const shownRead = portfolio?.kind === 'read' ? portfolio : null;

  return (
    <>
      <OwnProfile
        who={{ userId: who.address, handle: who.handle, name: who.name, pictureUrl: who.pictureUrl, bio: '', followers: 0, following: 0 }}
        card={canAct && card.state === 'ready' ? card.value : null}
        reloadCard={reloadCard}
        address={who.address}
        data={portfolio}
        total={shownRead === null ? null : totalWords(shownRead.totalUsd)}
        asOf={shownRead !== null && totalAsOf !== null ? (shown?.unread === true ? `Couldn't read your wallet just now. Worth ${asOfWords(totalAsOf, now)}` : `Worth ${asOfWords(totalAsOf, now)}`) : null}
        rowsAsOf={shown?.asOf.holdings ?? null}
        points={points}
        range={range}
        onRange={setRange}
        over={over}
        below={
          <>
            {switcher}
            {!canAct ? <div className={box['viewNotice']}><Notice notice={LINKED_WALLET} /></div> : null}
          </>
        }
        now={now}
        signInName={who.name}
        onDeposit={canAct ? () => setSheet('receive') : null}
        editOpen={editing}
        onEditOpen={setEditing}
      />
      {sheet === 'send' ? <SendSheet holdings={holdings} onClose={() => setSheet(null)} /> : null}
      {sheet === 'receive' ? <ReceiveSheet address={who.address} onClose={() => setSheet(null)} /> : null}
    </>
  );
}

/* The phone's two keys for a wallet's last known dollars (shared/kept-reads.ts): each coin's last
   price, and the last read that had a total. Named for the wallet, never shared with another read. */
const pricesKey = (address: string): string => `wallet-prices:${address}`;
const lastReadKey = (address: string): string => `wallet-last-read:${address}`;

/**
 * The wallet as the screen shows it (wallet-view.ts steadyWallet): the read with its missing
 * dollars filled from their last price; while the read is the phone's kept one from an earlier
 * visit, its total says how old it is; and when the read failed, the last read that had a total,
 * said to be unread now. Null with nothing to show yet.
 */
function shownWallet(read: PortfolioData | null, stale: boolean, address: string, now: number): (SteadyWallet & { readonly unread: boolean }) | null {
  const last = kept<LastPrices>(pricesKey(address))?.value ?? null;
  if (read?.kind === 'read') {
    const s = steadyWallet(read, last, now);
    const keptAt = stale ? (kept(`wallet:${address}`)?.at ?? null) : null;
    const total = keptAt === null ? s.asOf.total : Math.min(keptAt, s.asOf.total ?? keptAt);
    return { ...s, asOf: { total, holdings: s.asOf.holdings }, unread: false };
  }
  if (read?.kind !== 'unavailable') return null;
  const good = kept<PortfolioData>(lastReadKey(address));
  if (good === undefined || good.value.kind !== 'read') return null;
  const s = steadyWallet(good.value, last, now);
  return { data: s.data, asOf: { total: Math.min(good.at, s.asOf.total ?? good.at), holdings: s.asOf.holdings }, unread: true };
}

function Arrow({ up = false }: { up?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: up ? undefined : 'rotate(180deg)' }}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

/* ★ THE LAST SIGNED-IN WALLET, REMEMBERED ON THE PHONE (the owner, 2026-10-18: "portfolio should
   load instantly"). Only public facts: the address and the name shown on it, never a key. While the
   session is still being restored, Portfolio opens on this wallet's last answer at once, read-only
   (no Send, no export), and swaps to the live session the moment it is back. Cleared on sign out. */
const LAST_WALLET = 'insidor.lastWallet.v1';
interface LastWallet { readonly address: string; readonly name: string | null; readonly handle: string | null; readonly pictureUrl: string | null }
function readLastWallet(): LastWallet | null {
  try {
    const raw = globalThis.localStorage?.getItem(LAST_WALLET);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LastWallet>;
    return typeof v.address === 'string' && v.address.length >= 32 ? { address: v.address, name: v.name ?? null, handle: v.handle ?? null, pictureUrl: v.pictureUrl ?? null } : null;
  } catch {
    return null;
  }
}
function writeLastWallet(v: LastWallet | null): void {
  try {
    if (v === null) globalThis.localStorage?.removeItem(LAST_WALLET);
    else globalThis.localStorage?.setItem(LAST_WALLET, JSON.stringify(v));
  } catch {
    /* a blocked store keeps nothing; Portfolio waits for the session as before */
  }
}

export function PortfolioScreen() {
  const { wallet, state } = useWallet();
  const linkedKey = useSyncExternalStore(
    (l) => (wallet === null ? () => undefined : wallet.subscribe(l)),
    () => (wallet === null ? '' : wallet.linkedWallets().join(',')),
  );
  const linked = linkedKey === '' ? [] : linkedKey.split(',');
  const [viewing, setViewing] = useState<string | null>(null);
  const toast = useToast();
  /* The provider's own window; we hear only whether it opened. */
  const exportKey = () => {
    void wallet?.showKeyExport().then((outcome) => {
      if (outcome !== 'shown') toast("Couldn't open the export", 'Try again in a moment.');
    });
  };

  if (state.kind === 'connected' || state.kind === 'wrong-network') {
    const id = wallet?.identity() ?? null;
    writeLastWallet({ address: state.account, name: id?.name ?? null, handle: id?.handle ?? null, pictureUrl: id?.pictureUrl ?? null });
    const shown = viewing !== null && linked.includes(viewing) ? viewing : state.account;
    const own = shown === state.account;
    const who: WhoAmI = own
      ? { name: id?.name ?? null, handle: id?.handle ?? null, pictureUrl: id?.pictureUrl ?? null, address: state.account }
      : { name: 'Linked wallet', handle: null, pictureUrl: null, address: shown };
    const switcher =
      linked.length === 0 ? null : (
        <div className={box['switcher']} role="group" aria-label="Wallet shown">
          {[state.account, ...linked].map((a) => (
            <button key={a} type="button" aria-pressed={a === shown} className={a === shown ? box['walletOn'] : box['wallet']} onClick={() => setViewing(a)}>
              {a === state.account ? 'Insidor wallet' : `Linked ${a.slice(0, 4)}…${a.slice(-4)}`}
            </button>
          ))}
        </div>
      );
    return (
      <Loaded
        key={shown}
        who={who}
        canAct={own}
        load={(signal) => fetchPortfolio(shown, '24h', signal)}
        history={(signal, range) => fetchWalletHistory(shown, range, signal)}
        exportKey={exportKey}
        ownAddress={state.account}
        profileKey={id?.handle ?? null}
        linked={linked}
        switcher={switcher}
        leave={{ label: 'Sign out', run: () => { writeLastWallet(null); void wallet?.disconnect(); } }}
      />
    );
  }

  /* Still restoring the session: the app now opens For You before the sign-in code has loaded, so
     a signed-in person can reach this tab a moment before their wallet is back. Say so, never
     "Sign in". */
  if (SIGN_IN_CONFIGURED && (state.kind === 'unavailable' || state.kind === 'connecting')) {
    const last = readLastWallet();
    if (last !== null) {
      return (
        <Loaded
          key={last.address}
          who={{ name: last.name, handle: last.handle, pictureUrl: last.pictureUrl, address: last.address }}
          canAct={false}
          load={(signal) => fetchPortfolio(last.address, '24h', signal)}
          history={(signal, range) => fetchWalletHistory(last.address, range, signal)}
          exportKey={() => undefined}
          ownAddress={last.address}
          profileKey={last.handle}
          linked={[]}
          switcher={null}
          leave={{ label: 'Sign out', run: () => { writeLastWallet(null); void wallet?.disconnect(); } }}
        />
      );
    }
    return (
      <section className={box['screen']}>
        <div className={box['signedOut']}>
          <b>Loading your portfolio</b>
        </div>
      </section>
    );
  }

  /* Signed out. With sign-in set up the front door stands in front of this; in a build without
     it, there is nothing to show — never a stand-in wallet. */
  return (
    <section className={box['screen']}>
      <div className={box['signedOut']}>
        <b>Sign in to see your portfolio</b>
        <p>Your holdings are read from the chain once you sign in with X.</p>
        <button
          type="button"
          className={box['linkButton']}
          onClick={() => {
            forgetEntered();
            window.location.hash = '#/';
            window.location.reload();
          }}
        >
          Sign in
        </button>
      </div>
    </section>
  );
}
