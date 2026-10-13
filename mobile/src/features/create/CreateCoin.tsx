/**
 * CREATE COIN — a centred modal, after Trador's `CreateSheet.tsx` and `ui/Modal.tsx`.
 *
 * The picture from the post (with "Change"), name chips from the post's subject when made from a
 * feed post (NameSuggestions.tsx: tapping one fills the name and ticker, both still editable, and
 * the picture stays the post's), a name and a ticker to edit, dev-buy presets and a
 * custom amount, the launch's costs and what the creator earns, and a Create button.
 *
 * ★ WITH TRADING OFF THE BUTTON SAYS "COMING SOON" AND DOES NOTHING ELSE. No coin is minted,
 * no address generated, no success shown; the fee lines say they are not known.
 *
 * ★ WITH TRADING ON, EVERY NUMBER IS THE CHAIN'S. Paused launches are said and nothing else is
 * offered; the costs are measured by simulating this exact launch; what the creator earns is the
 * launchpad's fee rate now. Create builds the launch unsigned and simulated (features/trade's
 * build-then-sign rule), your wallet signs it, and once it lands the coin is recorded against its
 * narrative as "Created on Insidor". The ticker check speaks only for coins Insidor has seen.
 */

import { useEffect, useState } from 'react';

import {
  buildLaunchTx, confirmLaunch, fetchLaunchRules, fetchTickerSeen, imageAsDataUrl, previewLaunch,
  type LaunchPreview, type LaunchRules,
} from '../../shared/api/index.ts';
import { useLoad } from '../../shared/hooks.ts';
import { hrefFor } from '../../shared/route.ts';
import { tradingOn } from '../../shared/trading.ts';
import { useWallet } from '../../shared/wallet.tsx';
import { confirmBuilt, fromBase64, toBaseUnits, type ConfirmOutcome } from '../trade/order-flow.ts';
import type { Measured } from '../../shared/format/measure.ts';
import { formatCount } from '../../shared/format/number.ts';
import { PENDING_GLYPH } from '../../shared/format/rendered.ts';
import type { Notice as NoticeCopy } from '../../shared/notice.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { useComingSoon } from '../../shared/ui/ComingSoon.tsx';
import { RocketIcon } from '../../shared/ui/icons.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { NameCallButtons } from '../owner/NameCall.tsx';
import { useIsOwner } from '../owner/hooks.ts';
import { NameSuggestions } from './NameSuggestions.tsx';
import { DEV_BUY_PRESETS, TICKER_MAX, cleanTicker, feeRate, presetsWithin, suggestTicker, supplyShare, tickerLine } from './create-form.ts';
import styles from './create.module.css';

export interface CreateFrom {
  /** The narrative the coin is made from, recorded with it once it exists. */
  readonly storyId?: string | null;
  readonly title: string;
  readonly reach: Measured;
  readonly thumbUrl: string | null;
  /** The post it is made from, when it is made from one post: it goes in the coin's description. */
  readonly link?: string | null;
  /** The feed post's id, when made from one: its name ideas are offered as chips (NameSuggestions). */
  readonly postId?: string | null;
  /** True when the server labels the story behind it as written by hand; the modal carries that label too. */
  readonly labelled: boolean;
}

const HAND_WRITTEN: NoticeCopy = {
  headline: 'Written by hand',
  detail: 'The server says the story behind this was written by hand, not seen anywhere.',
};

/** A figure nobody has read yet: a dash and the words, never a placeholder number. */
function Unknown() {
  return <span className={styles['unknown']}>{PENDING_GLYPH} not known yet</span>;
}

const TRADING = tradingOn({ VITE_TRADING: import.meta.env?.['VITE_TRADING'] as string | undefined });

export function CreateCoin({ from, onClose }: { from: CreateFrom; onClose: () => void }) {
  /* A story the server labels as written by hand is never launched from, trading on or not. */
  return TRADING && !from.labelled ? <LiveCreate from={from} onClose={onClose} /> : <SoonCreate from={from} onClose={onClose} />;
}

function SoonCreate({ from, onClose }: { from: CreateFrom; onClose: () => void }) {
  const soon = useComingSoon();
  const owner = useIsOwner();
  const [name, setName] = useState(from.title);
  const [ticker, setTicker] = useState(() => suggestTicker(from.title));
  const [devBuy, setDevBuy] = useState<number | null>(DEV_BUY_PRESETS[0] ?? null);
  const views = formatCount(from.reach);

  return (
    <Modal
      title="Create coin"
      subtitle={`From ${from.title}${views.kind === 'value' ? `, ${views.text} views` : ''}`}
      onClose={onClose}
    >
      {from.labelled ? <div className={styles['notice']}><Notice notice={HAND_WRITTEN} /></div> : null}

      <div className={styles['identity']}>
        <div className={styles['picture']}>
          <Thumb url={from.thumbUrl} size={92} />
          <button type="button" className={styles['change']} onClick={() => soon('Changing the picture')}>
            Change
          </button>
        </div>
        <div className={styles['inputs']}>
          <input aria-label="Name" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
          <input
            aria-label="Ticker"
            className={styles['tickerInput']}
            value={ticker}
            maxLength={TICKER_MAX}
            onChange={(e) => setTicker(cleanTicker(e.target.value))}
          />
        </div>
      </div>

      {from.postId ? (
        <NameSuggestions
          postId={from.postId}
          onPick={(idea) => {
            setName(idea.name.slice(0, 32));
            setTicker(cleanTicker(idea.ticker));
          }}
          beside={owner ? (idea) => <NameCallButtons itemId={from.postId ?? ''} suggestion={{ name: idea.name, ticker: idea.ticker }} /> : undefined}
        />
      ) : null}
      <p className={styles['check']}>Checking whether {ticker || 'a ticker'} is taken is coming soon.</p>

      <div className={styles['devBuy']}>
        <div>
          <b>Dev buy</b>
          <span>Optional, buy first at launch price</span>
        </div>
        <div className={styles['presets']}>
          {DEV_BUY_PRESETS.map((sol) => (
            <button
              key={sol}
              type="button"
              aria-pressed={devBuy === sol}
              className={`${styles['preset']} ${devBuy === sol ? styles['presetOn'] : ''}`}
              onClick={() => setDevBuy(devBuy === sol ? null : sol)}
            >
              {sol}
            </button>
          ))}
          <span className={styles['amount']}>{devBuy === null ? 'None' : <>{devBuy} <small>SOL</small></>}</span>
        </div>
      </div>

      <dl className={styles['terms']}>
        <div><dt>Launch fee</dt><dd><Unknown /></dd></div>
        <div><dt>You earn as creator</dt><dd><Unknown /></dd></div>
      </dl>

      <Button look="primary" size="large" className={styles['create']} onClick={() => soon('Creating a coin')}>
        <RocketIcon size={18} /> Create {ticker || 'coin'}
      </Button>
      <p className={styles['foot']}>When this is live: one approval in your wallet, listed on pump.fun.</p>
    </Modal>
  );
}

const SOL = (lamports: number): string => `${(lamports / 1e9).toLocaleString('en-US', { maximumFractionDigits: 4 })} SOL`;
/** Typing settles for this long before the launch is priced again. */
const SETTLE_MS = 500;

function LiveCreate({ from, onClose }: { from: CreateFrom; onClose: () => void }) {
  const { wallet, state } = useWallet();
  const owner = useIsOwner();
  const [name, setName] = useState(from.title.slice(0, 32));
  const [ticker, setTicker] = useState(() => suggestTicker(from.title));
  const [picked, setPicked] = useState<string | null>(null);
  const [preset, setPreset] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [seen, setSeen] = useState<number | null>(null);
  const [priced, setPriced] = useState<{ kind: 'none' } | { kind: 'asking' } | { kind: 'preview'; preview: LaunchPreview } | { kind: 'refused'; why: string }>({ kind: 'none' });
  const [outcome, setOutcome] = useState<ConfirmOutcome | 'working' | { kind: 'created'; mint: string } | null>(null);
  const [rules] = useLoad('launch-rules', (signal) => fetchLaunchRules(signal));
  const r: LaunchRules | null = rules.state === 'ready' ? rules.value : null;
  const cap = r === null ? 0n : BigInt(r.maxDevBuyLamports);
  const devLamports = custom.trim() !== '' ? toBaseUnits(custom, 9) : preset === null ? 0n : BigInt(Math.round(preset * 1e9));
  const account = state.kind === 'connected' ? state.account : null;

  useEffect(() => {
    if (ticker === '') return;
    const ac = new AbortController();
    const t = setTimeout(() => void fetchTickerSeen(ticker, ac.signal).then(setSeen, () => setSeen(null)), SETTLE_MS);
    return () => { clearTimeout(t); ac.abort(); };
  }, [ticker]);

  useEffect(() => {
    if (account === null || r === null || !r.open || name.trim() === '' || ticker === '' || devLamports === null) return;
    const ac = new AbortController();
    setPriced({ kind: 'asking' });
    const t = setTimeout(() => {
      previewLaunch({ wallet: account, name: name.trim(), symbol: ticker, devBuyLamports: devLamports.toString() }, ac.signal).then(
        (p) => setPriced(p.kind === 'preview' ? { kind: 'preview', preview: p.preview } : { kind: 'refused', why: p.why }),
        () => setPriced({ kind: 'refused', why: 'The launch could not be priced just now.' }),
      );
    }, SETTLE_MS);
    return () => { clearTimeout(t); ac.abort(); };
  }, [account, r?.open, name, ticker, devLamports?.toString()]);

  const pick = (file: File | undefined) => {
    if (file === undefined) return;
    const reader = new FileReader();
    reader.onload = () => setPicked(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const create = async () => {
    if (account === null || wallet === null || devLamports === null) return;
    setOutcome('working');
    const imageDataUrl = picked ?? (from.thumbUrl === null ? null : await imageAsDataUrl(from.thumbUrl));
    if (imageDataUrl === null) {
      setOutcome({ kind: 'blocked', why: "The post's picture couldn't be read. Tap Change and pick one." });
      return;
    }
    let mint = '';
    const done = await confirmBuilt(async () => {
      const built = await buildLaunchTx({ wallet: account, name: name.trim(), symbol: ticker, description: from.link ? `From ${from.link}` : `From ${from.title}`, imageDataUrl, devBuyLamports: devLamports.toString() });
      if (built.kind === 'blocked') return built;
      mint = built.mint;
      return { kind: 'ready', transaction: built.transaction };
    }, { signAndSend: (p) => wallet.signAndSendTransaction(p), decode: fromBase64 });
    if (done.kind !== 'sent') {
      setOutcome(done);
      return;
    }
    /* Landed takes a moment; recorded once the chain shows it. */
    for (let i = 0; i < 6; i += 1) {
      if (await confirmLaunch({ wallet: account, signature: done.ref, mint, storyId: from.storyId ?? null })) break;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    setOutcome({ kind: 'created', mint });
  };

  const presets = presetsWithin(cap);
  const preview = priced.kind === 'preview' ? priced.preview : null;
  const launchCost = preview === null ? null : preview.costs.reduce((s, c) => s + c.lamports, 0);

  if (outcome !== null && outcome !== 'working' && outcome.kind === 'created') {
    return (
      <Modal title="Created" onClose={onClose}>
        <div className={styles['createdLogo']}>
          <CoinLogo address={outcome.mint} ticker={ticker} imageUrl={picked ?? from.thumbUrl} size={64} />
        </div>
        <p className={styles['check']}>{ticker} is live on pump.fun, created on Insidor.</p>
        <a className={styles['link']} href={hrefFor({ screen: 'token', coinId: `solana:${outcome.mint}` })} onClick={onClose}>Open {ticker}</a>
      </Modal>
    );
  }

  return (
    <Modal title="Create coin" subtitle={`From ${from.title}`} onClose={onClose}>
      <div className={styles['identity']}>
        <div className={styles['picture']}>
          {picked !== null ? <img className={styles['picked']} src={picked} alt="" /> : <Thumb url={from.thumbUrl} size={92} />}
          <label className={styles['change']}>
            Change
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className={styles['file']} onChange={(e) => pick(e.target.files?.[0])} />
          </label>
        </div>
        <div className={styles['inputs']}>
          <input aria-label="Name" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
          <input aria-label="Ticker" className={styles['tickerInput']} value={ticker} maxLength={TICKER_MAX} onChange={(e) => setTicker(cleanTicker(e.target.value))} />
        </div>
      </div>

      {from.postId ? (
        <NameSuggestions
          postId={from.postId}
          onPick={(idea) => {
            setName(idea.name.slice(0, 32));
            setTicker(cleanTicker(idea.ticker));
          }}
          beside={owner ? (idea) => <NameCallButtons itemId={from.postId ?? ''} suggestion={{ name: idea.name, ticker: idea.ticker }} /> : undefined}
        />
      ) : null}
      <p className={styles['check']}>{tickerLine(ticker, seen)}</p>

      {rules.state === 'ready' && r === null ? <p className={styles['check']}>— the launchpad's rules couldn't be read just now.</p> : null}
      {r !== null && !r.open ? <p className={styles['check']}>pump.fun has new coins paused right now. Nothing can be created until it reopens.</p> : null}

      {r !== null && r.open ? (
        <>
          <div className={styles['devBuy']}>
            <div>
              <b>Dev buy</b>
              <span>Optional, buy first at launch price</span>
            </div>
            <div className={styles['presets']}>
              {presets.map((sol) => (
                <button key={sol} type="button" aria-pressed={preset === sol && custom === ''} className={`${styles['preset']} ${preset === sol && custom === '' ? styles['presetOn'] : ''}`} onClick={() => { setCustom(''); setPreset(preset === sol ? null : sol); }}>{sol}</button>
              ))}
              <input aria-label="Custom dev buy in SOL" className={styles['customInput']} inputMode="decimal" placeholder="Custom" value={custom} onChange={(e) => setCustom(e.target.value)} />
            </div>
          </div>

          <dl className={styles['terms']}>
            <div><dt>Launch cost</dt><dd>{launchCost === null ? <span className={styles['unknown']}>{priced.kind === 'asking' ? 'Measuring' : '—'}</span> : SOL(launchCost)}</dd></div>
            {preview !== null ? preview.costs.map((c) => (
              <div key={c.key} className={styles['sub']}><dt>{c.key === 'network' ? 'Network fee' : c.key === 'rent' ? 'Account rent' : 'pump.fun fee'}</dt><dd>{c.lamports === 0 && c.key === 'launchpad' ? 'Free' : SOL(c.lamports)}</dd></div>
            )) : null}
            {preview?.devBuy != null ? <div><dt>Dev buy</dt><dd>{SOL(preview.devBuy.lamports)}, {supplyShare(preview.devBuy.supplyBps)}</dd></div> : null}
            <div><dt>You earn as creator</dt><dd>{feeRate(r.creatorFeeBps)}</dd></div>
          </dl>
          {priced.kind === 'refused' ? <p className={styles['check']}>{priced.why}</p> : null}

          {account === null ? (
            wallet !== null && state.kind !== 'unavailable' && state.kind !== 'connecting' ? <Button look="primary" size="large" className={styles['create']} onClick={() => void wallet.connect()}>Sign in to create</Button> : <p className={styles['foot']}>Sign-in isn't set up in this build.</p>
          ) : outcome === 'working' ? (
            <p className={styles['foot']}>Storing the picture, checking the launch, then asking your wallet to sign.</p>
          ) : preview !== null && devLamports !== null && devLamports <= cap ? (
            <Button look="primary" size="large" className={styles['create']} onClick={() => void create()}>
              <RocketIcon size={18} /> Create {ticker || 'coin'}
            </Button>
          ) : null}
          {outcome !== null && outcome !== 'working' ? (
            <p className={styles['check']}>
              {outcome.kind === 'blocked' ? `Nothing was signed. ${outcome.why}` : outcome.kind === 'refused' ? 'You declined in your wallet. Nothing was created.' : outcome.kind === 'not-sent' ? outcome.why : 'Something went wrong signing. Nothing was created.'}
            </p>
          ) : null}
          <p className={styles['foot']}>One approval in your wallet, listed on pump.fun.</p>
        </>
      ) : null}
    </Modal>
  );
}
