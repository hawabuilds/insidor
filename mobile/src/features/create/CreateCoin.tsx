/**
 * CREATE COIN — the pop-up, after Trador's `components/CreateSheet.tsx` minus every stock step,
 * and its `Launched` success screen.
 *
 * The main sheet is five things and nothing else: the picture (the post's, with "Change"), the
 * name and ticker (the post's top name idea, its other ideas as one row of chips), the dev buy
 * (0, 0.5, 1, 2 SOL or a typed amount, in one row, 0 to start), one line for what the launch costs,
 * and the Create button. Description, socials, the creator fee and the owner's name feedback sit
 * behind "More options", closed when the sheet opens.
 *
 * ★ IT MUST FIT A 390×844 PHONE WITHOUT SCROLLING. A new line on the main sheet costs a line of
 * height that this sheet was cut down to earn; put it behind More options instead. More options
 * and the ticker's coin list each scroll inside their own box, so opening them never pushes the
 * button off the screen (the modal itself does not scroll).
 *
 * ★ WITH TRADING OFF, OR FROM A STORY WRITTEN BY HAND, THE BUTTON SAYS "COMING SOON" AND DOES
 * NOTHING ELSE. No coin is minted and no cost is shown; the cost line says it is not live.
 *
 * ★ WITH TRADING ON, EVERY NUMBER IS THE CHAIN'S, AND THE SAFETY IS THE TRADE SERVICE'S. The cost
 * is the simulation of this exact launch (`POST /launch/preview`), a dash with a reason when it
 * was not measured. Create asks the trade service to store the picture and build the launch
 * unsigned; the service refuses a wallet off its allowlist or a dev buy over its cap, simulates
 * the transaction, and only then hands it back (features/trade's build-then-sign rule). The
 * wallet signs it; once it lands it is recorded against its story as "Created on Insidor".
 * Any failure is one short line saying why, and nothing is signed.
 */

import { useEffect, useState } from 'react';

import {
  buildLaunchTx, confirmLaunch, fetchLaunchRules, fetchPostNames, fetchTickerCoins, imageAsDataUrl, previewLaunch,
  type LaunchPreview, type LaunchRules, type NameIdea, type SameNameCoins,
} from '../../shared/api/index.ts';
import { useLoad } from '../../shared/hooks.ts';
import { hrefFor } from '../../shared/route.ts';
import { tradingOn } from '../../shared/trading.ts';
import { useWallet } from '../../shared/wallet.tsx';
import { confirmBuilt, fromBase64, type ConfirmOutcome } from '../trade/order-flow.ts';
import type { Measured } from '../../shared/format/measure.ts';
import type { Notice as NoticeCopy } from '../../shared/notice.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { useComingSoon } from '../../shared/ui/ComingSoon.tsx';
import { RocketIcon } from '../../shared/ui/icons.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { NameCallButtons } from '../owner/NameCall.tsx';
import { useIsOwner } from '../owner/hooks.ts';
import { NameChips, TickerCoins } from './NameSuggestions.tsx';
import {
  DEV_BUY_DEFAULT, DEV_BUY_PRESETS, FIRST_SHEET, NAME_MAX, TICKER_MAX, cleanTicker, coinPageUrl, costLine, devBuyLamports, feeRate,
  firstFill, firstLinks, otherIdeas, presetsWithin, shareOnX, solText, tickerCheck, useOfList, type Links, type SheetState, type TickerUse,
} from './create-form.ts';
import styles from './create.module.css';

export interface CreateFrom {
  /** The narrative the coin is made from, recorded with it once it exists. */
  readonly storyId?: string | null;
  readonly title: string;
  readonly reach: Measured;
  readonly thumbUrl: string | null;
  /** The post it is made from, when it is made from one post: prefilled as the coin's link. */
  readonly link?: string | null;
  /** The feed post's id, when made from one: its name ideas fill the fields and the chips. */
  readonly postId?: string | null;
  /** True when the server labels the story behind it as written by hand; the sheet says so. */
  readonly labelled: boolean;
}

const HAND_WRITTEN: NoticeCopy = {
  headline: 'Written by hand',
  detail: 'The server says the story behind this was written by hand, not seen anywhere.',
};

const TRADING = tradingOn({ VITE_TRADING: import.meta.env?.['VITE_TRADING'] as string | undefined });

/** Typing settles for this long before the ticker is checked or the launch priced again. */
const SETTLE_MS = 500;
/** The picture's square on the sheet, in CSS pixels: Trador's 76. */
const PICTURE_PX = 76;
/** The coin's logo on the success screen, in CSS pixels. */
const LOGO_PX = 64;
/** A landed create takes a moment to be readable; asked this many times, this far apart. */
const CONFIRM_TRIES = 6;
const CONFIRM_GAP_MS = 2_000;
/** The description's limit, matched by the trade service's DESCRIPTION_MAX. */
const DESCRIPTION_MAX = 280;

export function CreateCoin({ from, onClose }: { from: CreateFrom; onClose: () => void }) {
  /* A story the server labels as written by hand is never launched from, trading on or not. */
  return TRADING && !from.labelled ? <LiveCreate from={from} onClose={onClose} /> : <SoonCreate from={from} onClose={onClose} />;
}

const NO_IDEAS: readonly NameIdea[] = [];

type TickerRead = { kind: 'checking' } | { kind: 'failed' } | { kind: 'read'; use: TickerUse; list: SameNameCoins };

/** Everything both sheets hold: the fields, the name ideas, the ticker check, More options. */
function useForm(from: CreateFrom) {
  const [ideasLoad] = useLoad(`post-names:${from.postId ?? ''}`, (signal) => (from.postId ? fetchPostNames(from.postId, signal) : Promise.resolve(NO_IDEAS)));
  const ideas = ideasLoad.state === 'ready' ? ideasLoad.value : NO_IDEAS;
  const first = firstFill([], from.title);
  const [name, setName] = useState(first.name);
  const [ticker, setTicker] = useState(first.ticker);
  const [touched, setTouched] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [preset, setPreset] = useState(DEV_BUY_DEFAULT);
  const [custom, setCustom] = useState('');
  const [description, setDescription] = useState(from.link ? `From ${from.link}` : `From ${from.title}`);
  const [links, setLinks] = useState<Links>(() => firstLinks(from.link));
  const [sheet, setSheet] = useState<SheetState>(FIRST_SHEET);
  const [check, setCheck] = useState<TickerRead>({ kind: 'checking' });

  /* The top idea fills the fields when it arrives, unless the person already typed. */
  useEffect(() => {
    if (touched || ideas.length === 0) return;
    const f = firstFill(ideas, from.title);
    setName(f.name);
    setTicker(f.ticker);
  }, [ideas]);

  useEffect(() => {
    setSheet((s) => ({ ...s, coinsOpen: false }));
    if (ticker === '') return;
    setCheck({ kind: 'checking' });
    const ac = new AbortController();
    const t = setTimeout(() => void fetchTickerCoins(ticker, ac.signal).then(
      (list) => { if (!ac.signal.aborted) setCheck({ kind: 'read', use: useOfList(list), list }); },
      () => { if (!ac.signal.aborted) setCheck({ kind: 'failed' }); },
    ), SETTLE_MS);
    return () => { clearTimeout(t); ac.abort(); };
  }, [ticker]);

  return {
    from, ideas, name, ticker, picked, preset, custom, description, links, sheet, check,
    devLamports: devBuyLamports(preset, custom),
    typeName: (v: string) => { setTouched(true); setName(v.slice(0, NAME_MAX)); },
    typeTicker: (v: string) => { setTouched(true); setTicker(cleanTicker(v)); },
    pickIdea: (i: NameIdea) => { setTouched(true); setName(i.name.slice(0, NAME_MAX)); setTicker(cleanTicker(i.ticker)); },
    pickImage: (file: File | undefined) => {
      if (file === undefined) return;
      const reader = new FileReader();
      reader.onload = () => setPicked(typeof reader.result === 'string' ? reader.result : null);
      reader.readAsDataURL(file);
    },
    setPreset: (sol: number) => { setCustom(''); setPreset(sol); },
    setCustom: (v: string) => setCustom(v.replace(/[^0-9.]/g, '').slice(0, 8)),
    setDescription: (v: string) => setDescription(v.slice(0, DESCRIPTION_MAX)),
    setLinks,
    toggleMore: () => setSheet((s) => ({ ...s, more: !s.more })),
    toggleCoins: () => setSheet((s) => ({ ...s, coinsOpen: !s.coinsOpen })),
  };
}

type Form = ReturnType<typeof useForm>;

/** Picture, name, ticker, chips, the ticker line and the dev buy row. */
function Fields({ f, presets, live }: { f: Form; presets: readonly number[]; live: boolean }) {
  const soon = useComingSoon();
  const line = tickerCheck(f.ticker, f.check);
  return (
    <>
      <div className={styles['identity']}>
        <div className={styles['picture']}>
          {f.picked !== null ? <img className={styles['picked']} src={f.picked} alt="" /> : <Thumb url={f.from.thumbUrl} size={PICTURE_PX} />}
          {live ? (
            <label className={styles['change']}>
              Change
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className={styles['file']} onChange={(e) => f.pickImage(e.target.files?.[0])} />
            </label>
          ) : (
            <button type="button" className={styles['change']} onClick={() => soon('Changing the picture')}>Change</button>
          )}
        </div>
        <div className={styles['inputs']}>
          <input aria-label="Name" placeholder="Name" value={f.name} maxLength={NAME_MAX} onChange={(e) => f.typeName(e.target.value)} />
          <input aria-label="Ticker" placeholder="TICKER" className={styles['tickerInput']} value={f.ticker} maxLength={TICKER_MAX} onChange={(e) => f.typeTicker(e.target.value)} />
          {line.opens ? (
            <button type="button" className={`${styles['tickerLine']} ${styles['taken']}`} aria-expanded={f.sheet.coinsOpen} onClick={f.toggleCoins}>{line.text}</button>
          ) : (
            <span className={`${styles['tickerLine']} ${line.text === 'Free' ? styles['free'] : ''}`}>{line.text}</span>
          )}
        </div>
      </div>
      {f.sheet.coinsOpen && f.check.kind === 'read' ? <TickerCoins ticker={f.ticker} list={f.check.list} /> : null}

      <NameChips ideas={otherIdeas(f.ideas, f.ticker)} onPick={f.pickIdea} />

      <div className={styles['devBuy']}>
        <span className={styles['label']}>Dev buy</span>
        <div className={styles['presets']}>
          {presets.map((sol) => {
            const on = f.custom === '' && f.preset === sol;
            return (
              <button key={sol} type="button" aria-pressed={on} className={`${styles['preset']} ${on ? styles['presetOn'] : ''}`} onClick={() => f.setPreset(sol)}>{sol}</button>
            );
          })}
          <label className={styles['custom']}>
            <input aria-label="Dev buy in SOL" inputMode="decimal" placeholder="Custom" value={f.custom} onChange={(e) => f.setCustom(e.target.value)} />
            <small>SOL</small>
          </label>
        </div>
      </div>
    </>
  );
}

/** The link and what it opens: description, socials, the creator fee, the owner's name calls. */
function MoreOptions({ f, creatorFee }: { f: Form; creatorFee: string }) {
  const owner = useIsOwner();
  const postId = f.from.postId ?? null;
  if (!f.sheet.more) {
    return <button type="button" className={styles['moreLink']} aria-expanded={false} onClick={f.toggleMore}>More options</button>;
  }
  return (
    <>
      <button type="button" className={styles['moreLink']} aria-expanded onClick={f.toggleMore}>Fewer options</button>
      <div className={styles['more']}>
        <textarea aria-label="Description" placeholder="Description" rows={2} value={f.description} onChange={(e) => f.setDescription(e.target.value)} />
        <input aria-label="X link" placeholder="X link" value={f.links.twitter} onChange={(e) => f.setLinks({ ...f.links, twitter: e.target.value })} />
        <input aria-label="Telegram link" placeholder="Telegram link" value={f.links.telegram} onChange={(e) => f.setLinks({ ...f.links, telegram: e.target.value })} />
        <input aria-label="Website" placeholder="Website" value={f.links.website} onChange={(e) => f.setLinks({ ...f.links, website: e.target.value })} />
        <p className={styles['fee']}><span>You earn as creator</span><b>{creatorFee}</b></p>
        {owner && postId !== null
          ? f.ideas.map((idea) => (
            <div key={idea.ticker} className={styles['call']}>
              <b>{idea.name} ${idea.ticker}</b>
              <NameCallButtons itemId={postId} suggestion={{ name: idea.name, ticker: idea.ticker }} />
            </div>
          ))
          : null}
      </div>
    </>
  );
}

function SoonCreate({ from, onClose }: { from: CreateFrom; onClose: () => void }) {
  const soon = useComingSoon();
  const f = useForm(from);
  return (
    <Modal title="Create coin" onClose={onClose}>
      {from.labelled ? <div className={styles['notice']}><Notice notice={HAND_WRITTEN} /></div> : null}
      <Fields f={f} presets={DEV_BUY_PRESETS} live={false} />
      <p className={styles['cost']}>{costLine({ kind: 'off' })}</p>
      <MoreOptions f={f} creatorFee="— not live yet" />
      <Button look="primary" size="large" className={styles['create']} onClick={() => soon('Creating a coin')}>
        <RocketIcon size={18} /> Create coin
      </Button>
    </Modal>
  );
}

type Priced = { kind: 'none' } | { kind: 'asking' } | { kind: 'preview'; preview: LaunchPreview } | { kind: 'refused'; why: string };
type Outcome = ConfirmOutcome | 'working' | { kind: 'created'; mint: string } | null;

/** One short line for a launch that did not happen. */
function failedLine(o: ConfirmOutcome): string {
  if (o.kind === 'blocked' || o.kind === 'not-sent') return o.why;
  if (o.kind === 'refused') return 'You declined in your wallet. Nothing was created.';
  return 'Signing failed. Nothing was created.';
}

function LiveCreate({ from, onClose }: { from: CreateFrom; onClose: () => void }) {
  const { wallet, state } = useWallet();
  const f = useForm(from);
  const [priced, setPriced] = useState<Priced>({ kind: 'none' });
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [rules] = useLoad('launch-rules', (signal) => fetchLaunchRules(signal));
  const r: LaunchRules | null = rules.state === 'ready' ? rules.value : null;
  const cap = r === null ? 0n : BigInt(r.maxDevBuyLamports);
  const dev = f.devLamports;
  const account = state.kind === 'connected' ? state.account : null;

  useEffect(() => {
    if (account === null || r === null || !r.open || f.name.trim() === '' || f.ticker === '' || dev === null || dev > cap) {
      setPriced({ kind: 'none' });
      return;
    }
    const ac = new AbortController();
    setPriced({ kind: 'asking' });
    const t = setTimeout(() => {
      previewLaunch({ wallet: account, name: f.name.trim(), symbol: f.ticker, devBuyLamports: dev.toString() }, ac.signal).then(
        (p) => { if (!ac.signal.aborted) setPriced(p.kind === 'preview' ? { kind: 'preview', preview: p.preview } : { kind: 'refused', why: p.why }); },
        () => { if (!ac.signal.aborted) setPriced({ kind: 'refused', why: "The launch couldn't be priced just now." }); },
      );
    }, SETTLE_MS);
    return () => { clearTimeout(t); ac.abort(); };
  }, [account, r?.open, f.name, f.ticker, dev?.toString()]);

  const create = async () => {
    if (account === null || wallet === null || dev === null) return;
    setOutcome('working');
    const imageDataUrl = f.picked ?? (from.thumbUrl === null ? null : await imageAsDataUrl(from.thumbUrl));
    if (imageDataUrl === null) {
      setOutcome({ kind: 'blocked', why: "The post's picture couldn't be read. Tap Change and pick one." });
      return;
    }
    let mint = '';
    const done = await confirmBuilt(async () => {
      const built = await buildLaunchTx({ wallet: account, name: f.name.trim(), symbol: f.ticker, description: f.description.trim(), imageDataUrl, devBuyLamports: dev.toString(), links: f.links });
      if (built.kind === 'blocked') return built;
      mint = built.mint;
      return { kind: 'ready', transaction: built.transaction };
    }, { signAndSend: (p) => wallet.signAndSendTransaction(p), decode: fromBase64 });
    if (done.kind !== 'sent') {
      setOutcome(done);
      return;
    }
    for (let i = 0; i < CONFIRM_TRIES; i += 1) {
      if (await confirmLaunch({ wallet: account, signature: done.ref, mint, storyId: from.storyId ?? null })) break;
      await new Promise((resolve) => setTimeout(resolve, CONFIRM_GAP_MS));
    }
    setOutcome({ kind: 'created', mint });
  };

  if (outcome !== null && outcome !== 'working' && outcome.kind === 'created') {
    return <Launched mint={outcome.mint} ticker={f.ticker} imageUrl={f.picked ?? from.thumbUrl} onClose={onClose} />;
  }

  const cost = account === null ? costLine({ kind: 'signed-out' })
    : priced.kind === 'preview' ? costLine({ kind: 'measured', lamports: priced.preview.costs.map((c) => c.lamports) })
      : priced.kind === 'asking' ? costLine({ kind: 'measuring' })
        : costLine({ kind: 'unread' });

  /* Why Create is not offered, if it is not; else why the last try failed. One line, never both. */
  const stop = rules.state === 'loading' ? null
    : r === null ? "The launchpad couldn't be read just now."
      : !r.open ? 'pump.fun has new coins paused right now.'
        : f.name.trim() === '' ? 'Add a name.'
          : f.ticker === '' ? 'Add a ticker.'
            : dev === null ? 'The dev buy must be an amount of SOL.'
              : dev > cap ? `The dev buy is capped at ${solText(Number(cap))}.`
                : priced.kind === 'refused' ? priced.why
                  : null;
  const failed = outcome !== null && outcome !== 'working' ? failedLine(outcome) : null;
  const why = stop ?? failed;
  const offered = rules.state === 'ready' && stop === null;

  return (
    <Modal title="Create coin" onClose={outcome === 'working' ? () => undefined : onClose}>
      <Fields f={f} presets={presetsWithin(cap)} live />
      <p className={styles['cost']}>{cost}</p>
      <MoreOptions f={f} creatorFee={r === null ? "— couldn't be read" : feeRate(r.creatorFeeBps)} />
      {why !== null ? <p className={styles['why']} role="alert">{why}</p> : null}
      {account === null ? (
        wallet !== null && state.kind !== 'unavailable' && state.kind !== 'connecting'
          ? <Button look="primary" size="large" className={styles['create']} onClick={() => void wallet.connect()}>Sign in to create</Button>
          : <p className={styles['why']}>Sign-in isn't set up in this build.</p>
      ) : outcome === 'working' ? (
        <p className={styles['working']}>Checking the launch, then your wallet asks to sign.</p>
      ) : !offered ? null : (
        <Button look="primary" size="large" className={styles['create']} onClick={() => void create()}>
          <RocketIcon size={18} /> Create coin
        </Button>
      )}
    </Modal>
  );
}

/** Trador's `Launched`: the coin's logo, View coin, Share on X. */
function Launched({ mint, ticker, imageUrl, onClose }: { mint: string; ticker: string; imageUrl: string | null; onClose: () => void }) {
  const hash = hrefFor({ screen: 'token', coinId: `solana:${mint}` });
  const page = coinPageUrl(window.location.origin, window.location.pathname, hash);
  return (
    <Modal title={`$${ticker} is live`} onClose={onClose}>
      <div className={styles['launched']}>
        <CoinLogo address={mint} ticker={ticker} imageUrl={imageUrl} size={LOGO_PX} />
        <a className={styles['view']} href={hash} onClick={onClose}>View coin</a>
        <a className={styles['share']} href={shareOnX(ticker, page)} target="_blank" rel="noreferrer">Share on X</a>
      </div>
    </Modal>
  );
}
