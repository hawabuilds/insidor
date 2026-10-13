/**
 * CHOOSE COIN — every coin with the post's name, highest market cap first, opened from the post
 * sheet's "All N coins". Each row opens its coin's token page; its ⚡ button buys the saved quick
 * buy amount at once (quick-buy.ts), checked before signing, and the toast says what happened with
 * a link to the transaction.
 *
 * A view inside the post sheet rather than a sheet of its own, so its back arrow returns to the post
 * without reading it again and the tab bar under both is never touched. It fills the post sheet's
 * three parts (shared/ui/Sheet.tsx): the head (back, title, the chip, the X), the list, which
 * scrolls, and "None of these, create one" fixed at the bottom clear of the home bar.
 *
 * ★ THE QUICK BUY CHIP, after HODL's desktop one: "⚡ 0.025 SOL 3%" at the top right opens a small
 * panel with the amounts and slippages; a change updates every ⚡ on the screen at once and is saved
 * for this wallet. An amount over the trading cap at the chosen slippage is not offered at all. The
 * panel lies over the list without moving it, and closes like any pop-up: its own X, a tap beside
 * it, back, or Escape (each of those closes only the panel, not the sheet under it).
 * ★ When none of the coins is proven, one line says so and points to the charts: a list is not a
 * recommendation.
 *
 * What breaks if changed carelessly: the cap comes with a coin's venue from the trade service; with
 * no cap read, no amount is offered and the ⚡ buttons are not drawn — never a guess at the cap.
 */

import { useEffect, useState, type ReactNode } from 'react';

import { fetchTradeVenue, type PostSheetData, type SheetCoin, type TradeLimits } from '../../shared/api/index.ts';
import { useNow } from '../../shared/hooks.ts';
import { useWallet } from '../../shared/wallet.tsx';
import { useDismiss } from '../../shared/ui/dismiss.ts';
import { BackIcon, CloseIcon } from '../../shared/ui/icons.tsx';
import { SheetBody, SheetFoot, SheetHead } from '../../shared/ui/Sheet.tsx';
import { TRADING, type SheetNote } from './BuyOpen.tsx';
import { CoinLine } from './CoinLine.tsx';
import { effectiveChoice, outcomeLine, quickAmounts, quickBuy, quickSlippages, readQuickChoice, saveQuickChoice, type QuickChoice } from './quick-buy.ts';
import { BoltIcon } from './sheet-icons.tsx';
import styles from './post-sheet.module.css';

export function ChooseCoin({ data, onBack, onOpenCoin, onCreate, onNote }: {
  data: PostSheetData;
  onBack: () => void;
  onOpenCoin: (c: SheetCoin) => void;
  onCreate: () => void;
  onNote: (n: SheetNote) => void;
}) {
  const now = useNow();
  const { wallet, state } = useWallet();
  const account = state.kind === 'connected' ? state.account : null;
  const [saved, setSaved] = useState<QuickChoice>(() => readQuickChoice(account));
  const [limits, setLimits] = useState<TradeLimits | null | 'reading'>(TRADING ? 'reading' : null);
  const [panel, setPanel] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  /* The cap is the trade service's, read with any coin's venue; one read for the screen. */
  const first = data.coins[0]?.address ?? null;
  useEffect(() => {
    if (!TRADING || first === null) return;
    const ac = new AbortController();
    fetchTradeVenue(first, ac.signal).then((v) => setLimits(v.limits), () => {
      if (!ac.signal.aborted) setLimits(null);
    });
    return () => ac.abort();
  }, [first]);
  useEffect(() => setSaved(readQuickChoice(account)), [account]);

  const cap = limits === 'reading' ? null : limits;
  const choice = TRADING && cap !== null ? effectiveChoice(saved, cap) : null;
  const choose = (next: QuickChoice) => {
    const fitted = effectiveChoice(next, cap) ?? next;
    setSaved(fitted);
    saveQuickChoice(account, fitted);
  };
  const noneProven = !data.coins.some((c) => c.proven);
  const name = data.coinName ?? 'Same-name';

  const buy = async (c: SheetCoin) => {
    if (choice === null || busy !== null) return;
    const ticker = c.ticker ?? c.name ?? '';
    if (wallet === null || account === null) {
      onNote({ line: 'Sign in to buy.' });
      return;
    }
    setBusy(c.address);
    try {
      const outcome = await quickBuy({ mint: c.address, account, choice }, { signAndSend: (p) => wallet.signAndSendTransaction(p) });
      onNote(outcome.kind === 'sent' ? { line: outcomeLine(outcome, choice.amountSol, ticker), tx: outcome.ref } : { line: outcomeLine(outcome, choice.amountSol, ticker) });
    } catch {
      onNote({ line: outcomeLine({ kind: 'failed' }, choice.amountSol, ticker) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SheetHead>
        <button type="button" className={styles['round']} aria-label="Back to the post" onClick={onBack}><BackIcon size={20} /></button>
        <span className={styles['chooseTitle']}>
          <b>{name} coins</b>
          <span>Highest MC first</span>
        </span>
        {choice !== null ? (
          <button type="button" className={styles['chip']} aria-expanded={panel} onClick={() => setPanel((p) => !p)}>
            <BoltIcon size={16} className={styles['bolt']} />
            <b>{choice.amountSol} SOL</b>
            <span>{choice.slippageBps / 100}%</span>
          </button>
        ) : null}
      </SheetHead>

      <SheetBody>
        <div className={styles['scroll']}>
          {TRADING && limits === null && data.coins.length > 0 ? <p className={styles['note']}>Quick buy isn't available just now. Tap a coin to buy from its page.</p> : null}
          {noneProven ? <p className={styles['banner']}>None proven from this post. Tap a coin to check its chart.</p> : null}
          {data.sourcesMissing > 0 ? <p className={styles['note']}>The market could not be read, so some numbers are missing.</p> : null}

          <div className={styles['chooseList']}>
            {data.coins.map((c) => (
              <CoinLine key={c.address} coin={c} now={now} onOpen={() => onOpenCoin(c)} action={
                choice !== null ? (
                  <button type="button" className={styles['bolted']} aria-label={`Buy ${choice.amountSol} SOL of ${c.ticker ?? c.name ?? 'this coin'}`} onClick={(e) => {
                    e.stopPropagation();
                    void buy(c);
                  }}>
                    {busy === c.address ? 'Buying' : <><BoltIcon size={14} /> {choice.amountSol}</>}
                  </button>
                ) : null
              } />
            ))}
          </div>
        </div>
      </SheetBody>

      <SheetFoot>
        <button type="button" className={`${styles['dark']} ${styles['wide']}`} onClick={onCreate}>None of these, create one</button>
      </SheetFoot>

      {panel && choice !== null ? (
        <QuickPanel onClose={() => setPanel(false)}>
          <span className={styles['label']}>Quick buy amount</span>
          <div className={styles['choices']}>
            {quickAmounts(cap, choice.slippageBps).map((a) => (
              <button key={a} type="button" aria-pressed={a === choice.amountSol} className={a === choice.amountSol ? styles['choiceOn'] : ''} onClick={() => choose({ ...choice, amountSol: a })}>{a}</button>
            ))}
          </div>
          <span className={styles['label']}>Slippage</span>
          <div className={styles['choices']}>
            {quickSlippages(cap).filter((b) => quickAmounts(cap, b).length > 0).map((b) => (
              <button key={b} type="button" aria-pressed={b === choice.slippageBps} className={b === choice.slippageBps ? styles['choiceOn'] : ''} onClick={() => choose({ ...choice, slippageBps: b })}>{b / 100}%</button>
            ))}
          </div>
          <p className={styles['panelNote']}>One tap on a coin's buy button buys this amount. Checked before signing.</p>
        </QuickPanel>
      ) : null}
    </>
  );
}

/** The quick buy panel: over the list, under the chip, with its own X; a tap beside it closes it. */
function QuickPanel({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useDismiss(onClose);
  return (
    <>
      <div className={styles['panelScrim']} onClick={onClose} />
      <div className={styles['panel']} role="dialog" aria-label="Quick buy">
        <div className={styles['panelHead']}>
          <b>Quick buy</b>
          <button type="button" className={styles['panelClose']} aria-label="Close quick buy" onClick={onClose}><CloseIcon size={18} /></button>
        </div>
        {children}
      </div>
    </>
  );
}
