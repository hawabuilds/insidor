/**
 * THE AUTO BUY SHEET (the owner, 2026-11-05, the neutral design): on a watched post with no coin yet,
 * how much to buy when its coin starts running, under what market cap, PvP, for how long, and the
 * speed and slippage. One sheet, one tap. Saved to the alert service (shared/auto-buys.ts); the
 * buying itself happens on the server, and is a dry run until the owner turns it live.
 *
 * Its own file so the feed card and the post sheet open the same sheet with the same rules.
 *
 * ★ FACTS ONLY. The balance is read from the wallet; one that could not be read says so and is
 * never taken as enough or as short. The fees are the server's estimate per speed. There is no
 * dollar figure: the app has no SOL price, and a guessed one is not shown.
 *
 * ★ NO DISABLED BUTTON (the screen rule). Short on SOL, the one button is Deposit, with how much
 * more is needed above it; saving, it says so; saved, it says "Auto buy on" for a moment and the
 * sheet closes.
 *
 * What breaks if changed carelessly: amounts are lamports, whole numbers. Every choice comes from
 * the server's config, and the server checks each again, so the sheet never offers what it refuses.
 */

import { useEffect, useState, type ReactNode } from 'react';

import { posthog } from '../../posthog.ts';
import { fetchPortfolio } from '../../shared/api/index.ts';
import type { RisingPost } from '../../shared/api/index.ts';
import { autoBuys, useAutoBuys, type Speed } from '../../shared/auto-buys.ts';
import { useWallet } from '../../shared/wallet.tsx';
import { watchedPosts } from '../../shared/watched-posts.ts';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { CheckIcon, ChevronIcon } from '../../shared/ui/icons.tsx';
import { Sheet, SheetBody, SheetFoot, SheetHead } from '../../shared/ui/Sheet.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { ReceiveSheet } from '../portfolio/ReceiveSheet.tsx';
import { activeOf, capOf, solOf } from './format.ts';
import s from './auto-buy.module.css';

const LAMPORTS = 1_000_000_000;
const SAVED_FOR_MS = 900;
const SPEED_LABEL: Record<Speed, string> = { normal: 'Normal', fast: 'Fast', turbo: 'Turbo' };

function Seg<T extends string | number>({ items, on, label, pick }: { items: readonly T[]; on: T; label: (t: T) => string; pick: (t: T) => void }) {
  return (
    <div className={s['seg']}>
      {items.map((i) => <button key={String(i)} type="button" aria-pressed={i === on} className={i === on ? s['segOn'] : ''} onClick={() => pick(i)}>{label(i)}</button>)}
    </div>
  );
}

function Row({ title, value, open, onTap, off = false }: { title: string; value: ReactNode; open: boolean; onTap: () => void; off?: boolean }) {
  return (
    <button type="button" className={s['row']} aria-expanded={open} onClick={onTap}>
      <span className={s['rowText']}>{title}</span>
      <span className={`${s['value']} ${off ? s['valueOff'] : ''}`}>{value}</span>
      <span className={`${s['chev']} ${open ? s['chevOpen'] : ''}`}><ChevronIcon size={14} /></span>
    </button>
  );
}

type Open = 'cap' | 'pvp' | 'active' | 'advanced' | null;

export function AutoBuySheet({ post, onClose }: { post: RisingPost; onClose: () => void }) {
  const store = useAutoBuys();
  const toast = useToast();
  const { state } = useWallet();
  const account = state.kind === 'connected' ? state.account : null;
  const choices = store.choices();
  const existing = store.get(post.id);

  const [lamports, setLamports] = useState(existing?.lamports ?? choices?.amountsLamports[choices.amountsLamports.length - 1] ?? 0);
  const [cap, setCap] = useState<number | null>(existing?.maxCapUsd ?? choices?.capsUsd[1] ?? null);
  const [pvp, setPvp] = useState(existing?.pvpCoins ?? 1);
  const [activeMs, setActiveMs] = useState(choices?.activeMs[1] ?? 0);
  const [speed, setSpeed] = useState<Speed>(existing?.speed ?? 'fast');
  const [slippage, setSlippage] = useState(existing?.slippageBps ?? choices?.slippagesBps[1] ?? 0);
  const [open, setOpen] = useState<Open>(null);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [depositing, setDepositing] = useState(false);
  const [balance, setBalance] = useState<number | 'reading' | 'unread'>('reading');

  useEffect(() => {
    if (account === null) return void setBalance('unread');
    const ac = new AbortController();
    fetchPortfolio(account, '24h', ac.signal).then(
      (p) => setBalance(p.kind === 'read' && p.solBalance.known ? Math.round(p.solBalance.amount * LAMPORTS) : 'unread'),
      () => setBalance('unread'),
    );
    return () => ac.abort();
  }, [account]);

  if (choices === null) return null;
  const toggle = (k: Open) => setOpen((o) => (o === k ? null : k));
  const coins = Math.max(1, pvp);
  const fee = choices.feeLamports[speed];
  const total = (lamports + fee) * coins;
  const short = typeof balance === 'number' && balance < total;
  const needed = typeof balance === 'number' ? total - balance : 0;

  const save = async () => {
    if (phase !== 'idle') return;
    setPhase('saving');
    try {
      await autoBuys.save(post.id, { lamports, maxCapUsd: cap, pvpCoins: coins, speed, slippageBps: slippage, activeMs });
      posthog.capture('auto_buy_saved', { is_update: existing !== null, pvp_enabled: coins > 1 });
      /* The server watched the post with it (services/notify auto-buy.ts): the star fills here too. */
      if (!watchedPosts.ids().includes(post.id)) void watchedPosts.set(post.id, true).catch(() => undefined);
      setPhase('saved');
      window.setTimeout(() => {
        onClose();
        toast('Auto buy on', `${solOf(lamports)} SOL when the coin runs`);
      }, SAVED_FOR_MS);
    } catch (e) {
      setPhase('idle');
      toast("Couldn't set auto buy", e instanceof Error ? e.message : 'Try again in a moment.');
    }
  };
  const turnOff = async () => {
    try {
      await autoBuys.off(post.id);
      posthog.capture('auto_buy_disabled');
      onClose();
      toast('Auto buy off');
    } catch (e) {
      toast("Couldn't turn it off", e instanceof Error ? e.message : 'Try again in a moment.');
    }
  };

  if (depositing && account !== null) return <ReceiveSheet address={account} onClose={() => setDepositing(false)} />;

  return (
    <Sheet label="Auto buy" onClose={onClose} fit>
      <SheetHead>
        <div className={s['who']}>
          {post.thumbUrl !== null ? <Thumb url={post.thumbUrl} file={post.thumbFile} size={40} radius={12} /> : null}
          <div className={s['whoText']}>
            <h2 className={s['whoTitle']}>Auto buy</h2>
            <div className={s['whoSub']}>{post.authorLabel} <span className={s['pill']}>No coin yet</span></div>
          </div>
        </div>
      </SheetHead>
      <SheetBody>
        <div className={s['hero']}>
          <span className={s['heroLabel']}>Each buy</span>
          <div className={s['amount']}><b>{solOf(lamports)}</b><span>SOL</span></div>
          <div className={s['heroSub']}>{balance === 'reading' ? 'Reading your balance' : balance === 'unread' ? "Couldn't read your balance" : `You have ${solOf(balance)} SOL`}</div>
        </div>
        <div className={s['chips']}>
          {choices.amountsLamports.map((c) => (
            <button key={c} type="button" aria-pressed={c === lamports} className={`${s['chip']} ${c === lamports ? s['chipOn'] : ''}`} onClick={() => setLamports(c)}>{solOf(c)}</button>
          ))}
        </div>
        <div className={s['group']}>
          <Row title="Buy below market cap" value={cap === null ? 'Any' : capOf(cap)} open={open === 'cap'} onTap={() => toggle('cap')} />
          {open === 'cap' ? <div className={s['pick']}><Seg items={choices.capsUsd} on={cap ?? -1} label={capOf} pick={setCap} /></div> : null}
          <button type="button" className={s['row']} role="switch" aria-checked={pvp > 1} onClick={() => { setPvp((n) => (n > 1 ? 1 : 2)); setOpen(pvp > 1 ? null : 'pvp'); }}>
            <span className={s['rowText']}>PvP</span>
            <span className={`${s['value']} ${pvp > 1 ? '' : s['valueOff']}`}>{pvp > 1 ? `Up to ${pvp} coins` : 'Off'}</span>
            <span className={`${s['toggle']} ${pvp > 1 ? s['toggleOn'] : ''}`}><i /></span>
          </button>
          {open === 'pvp' && pvp > 1 ? (
            <div className={s['pick']}>
              <Seg items={Array.from({ length: choices.maxPvpCoins - 1 }, (_, i) => i + 2)} on={pvp} label={(n) => `${n} coins`} pick={setPvp} />
            </div>
          ) : null}
          <Row title="Active for" value={activeOf(activeMs)} open={open === 'active'} onTap={() => toggle('active')} />
          {open === 'active' ? <div className={s['pick']}><Seg items={choices.activeMs} on={activeMs} label={activeOf} pick={setActiveMs} /></div> : null}
          <Row title="Advanced" value={`${SPEED_LABEL[speed]}, ${slippage / 100}%`} open={open === 'advanced'} onTap={() => toggle('advanced')} />
          {open === 'advanced' ? (
            <div className={s['pick']}>
              <div className={s['pickLabel']}><span>Speed</span><span>{solOf(choices.feeLamports[speed])} SOL a buy</span></div>
              <Seg items={['normal', 'fast', 'turbo'] as const} on={speed} label={(k) => SPEED_LABEL[k]} pick={setSpeed} />
              <div className={s['pickLabel']}><span>Max slippage</span><span>Fails rather than fill worse</span></div>
              <Seg items={choices.slippagesBps} on={slippage} label={(b) => `${b / 100}%`} pick={setSlippage} />
            </div>
          ) : null}
        </div>
      </SheetBody>
      <SheetFoot>
        <div className={s['sum']}>
          <div className={s['sumLine']}><span>Est. fees</span><em>{solOf(fee * coins)} SOL</em></div>
          <div className={s['sumLine']}><span>Max total</span><b>{solOf(total)} SOL</b></div>
          {short ? <div className={s['sumLine']}><span>You need</span><em className={s['need']}>{solOf(needed)} SOL more</em></div> : null}
        </div>
        {short ? (
          <button type="button" className={s['primary']} onClick={() => setDepositing(true)}>Deposit SOL</button>
        ) : (
          <button type="button" className={s['primary']} onClick={() => void save()}>
            {phase === 'saved' ? <><CheckIcon size={18} /> Auto buy on</> : phase === 'saving' ? 'Setting auto buy' : existing !== null ? 'Update auto buy' : 'Set auto buy'}
          </button>
        )}
        {existing !== null && phase === 'idle' ? <button type="button" className={s['quiet']} onClick={() => void turnOff()}>Turn off auto buy</button> : null}
        <p className={s['consent']}>{short ? 'Add SOL, then set auto buy.' : 'Insidor buys for you within these limits. Turn it off any time.'}</p>
      </SheetFoot>
    </Sheet>
  );
}
