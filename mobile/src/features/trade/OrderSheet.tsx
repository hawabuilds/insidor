/**
 * THE ORDER SHEET: an amount, a price, and one confirm — Trador's OrderSheet rebuilt in our
 * style, cut to what a launchpad coin needs.
 *
 * The price shown is the trade service's quote, word for word: what you pay, what you get, the
 * worst case at your slippage, and where it trades. Confirm sends that same quote back to be
 * built and simulated; only a passing simulation reaches the wallet, which signs and nothing
 * else. Every outcome is said in words: sent (with the transaction), declined by you, blocked
 * by the simulation (with its reason), or not taken by the network.
 */

import { useEffect, useState } from 'react';

import { buildTrade, fetchHolding, fetchTradeQuote, type TradeQuote } from '../../shared/api/index.ts';
import { useWallet } from '../../shared/wallet.tsx';
import { Button } from '../../shared/ui/Button.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import { confirmOrder, fromBase64, fromBaseUnits, toBaseUnits, type ConfirmOutcome } from './order-flow.ts';
import styles from './trade.module.css';

const SOL_DECIMALS = 9;
/** Every launchpad coin has six decimals. */
const COIN_DECIMALS = 6;
const BUY_PRESETS = ['0.01', '0.025', '0.05'];
/** Shares of what the wallet holds, each with its own label: all of it is "All". */
const SELL_PRESETS: readonly { readonly pct: bigint; readonly label: string }[] = [
  { pct: 25n, label: '25%' },
  { pct: 50n, label: '50%' },
  { pct: 100n, label: 'All' },
];
const SLIPPAGES = [100, 300, 500, 1000];
const DEFAULT_SLIPPAGE = 300;
/** Typing settles for this long before a price is asked for. */
const SETTLE_MS = 400;

export function OrderSheet({ mint, ticker, side, onClose }: { mint: string; ticker: string; side: 'buy' | 'sell'; onClose: () => void }) {
  const { wallet, state } = useWallet();
  return (
    <Modal title={`${side === 'buy' ? 'Buy' : 'Sell'} ${ticker}`} onClose={onClose}>
      {state.kind !== 'connected' || wallet === null ? (
        <div className={styles['sheet']}>
          <p className={styles['note']}>Sign in to trade. Your wallet is created for you; Insidor never holds its key.</p>
          {wallet !== null && state.kind !== 'unavailable' && state.kind !== 'connecting' ? (
            <Button look="buy" size="large" onClick={() => void wallet.connect()}>Sign in with X</Button>
          ) : null}
        </div>
      ) : (
        <Ticket mint={mint} ticker={ticker} side={side} account={state.account} signAndSend={(p) => wallet.signAndSendTransaction(p)} />
      )}
    </Modal>
  );
}

function Ticket({ mint, ticker, side, account, signAndSend }: {
  mint: string;
  ticker: string;
  side: 'buy' | 'sell';
  account: string;
  signAndSend: Parameters<typeof confirmOrder>[1]['signAndSend'];
}) {
  const [text, setText] = useState(side === 'buy' ? BUY_PRESETS[0] ?? '' : '');
  const [slippageBps, setSlippage] = useState(DEFAULT_SLIPPAGE);
  const [holding, setHolding] = useState<{ amount: string; decimals: number } | null | 'loading'>(side === 'sell' ? 'loading' : null);
  const [quote, setQuote] = useState<{ kind: 'none' } | { kind: 'asking' } | { kind: 'quote'; quote: TradeQuote } | { kind: 'refused'; why: string }>({ kind: 'none' });
  const [outcome, setOutcome] = useState<ConfirmOutcome | 'working' | null>(null);

  const decimals = side === 'buy' ? SOL_DECIMALS : holding !== null && holding !== 'loading' ? holding.decimals : COIN_DECIMALS;
  const amount = toBaseUnits(text, decimals);

  useEffect(() => {
    if (side !== 'sell') return;
    const ac = new AbortController();
    fetchHolding(mint, account, ac.signal).then((h) => setHolding(h), () => setHolding(null));
    return () => ac.abort();
  }, [side, mint, account]);

  useEffect(() => {
    if (amount === null) {
      setQuote({ kind: 'none' });
      return;
    }
    const ac = new AbortController();
    setQuote({ kind: 'asking' });
    const t = setTimeout(() => {
      fetchTradeQuote({ mint, side, amount: amount.toString(), wallet: account, slippageBps }, ac.signal).then(
        (q) => setQuote(q.kind === 'quote' ? { kind: 'quote', quote: q.quote } : { kind: 'refused', why: q.why }),
        () => setQuote({ kind: 'refused', why: 'No price could be read just now.' }),
      );
    }, SETTLE_MS);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [mint, side, account, slippageBps, amount?.toString()]);

  const confirm = async (q: TradeQuote) => {
    setOutcome('working');
    try {
      setOutcome(await confirmOrder(q, { build: (x) => buildTrade(x, account), signAndSend, decode: fromBase64 }));
    } catch {
      setOutcome({ kind: 'failed' });
    }
  };

  if (outcome !== null && outcome !== 'working') return <Outcome outcome={outcome} />;

  const held = holding !== null && holding !== 'loading' ? holding : null;
  return (
    <div className={styles['sheet']}>
      <label className={styles['label']} htmlFor="order-amount">{side === 'buy' ? 'You pay, in SOL' : `You sell, in ${ticker}`}</label>
      <input id="order-amount" className={styles['input']} inputMode="decimal" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
      <div className={styles['chips']}>
        {side === 'buy'
          ? BUY_PRESETS.map((p) => <button key={p} type="button" className={text === p ? styles['on'] : ''} onClick={() => setText(p)}>{p} SOL</button>)
          : held !== null && held.amount !== '0'
            ? SELL_PRESETS.map((p) => (
                <button key={p.label} type="button" onClick={() => setText(fromBaseUnits(((BigInt(held.amount) * p.pct) / 100n).toString(), held.decimals))}>{p.label}</button>
              ))
            : null}
      </div>
      {side === 'sell' ? (
        <p className={styles['note']}>
          {holding === 'loading' ? 'Reading what you hold.' : held === null ? '— what you hold could not be read' : held.amount === '0' ? `You hold no ${ticker}.` : `You hold ${fromBaseUnits(held.amount, held.decimals)} ${ticker}.`}
        </p>
      ) : null}

      <span className={styles['label']}>Slippage</span>
      <div className={styles['chips']}>
        {SLIPPAGES.map((s) => <button key={s} type="button" className={s === slippageBps ? styles['on'] : ''} onClick={() => setSlippage(s)}>{s / 100}%</button>)}
      </div>

      {quote.kind === 'asking' ? <p className={styles['note']}>Getting a price.</p> : null}
      {quote.kind === 'refused' ? <p className={styles['note']}>{quote.why}</p> : null}
      {quote.kind === 'quote' ? <Price quote={quote.quote} ticker={ticker} /> : null}

      {quote.kind === 'quote' && outcome !== 'working' ? (
        <Button look={side === 'buy' ? 'buy' : 'sell'} size="large" onClick={() => void confirm(quote.quote)}>
          Confirm {side === 'buy' ? 'buy' : 'sell'}
        </Button>
      ) : null}
      {outcome === 'working' ? <p className={styles['note']}>Checking the trade, then asking your wallet to sign.</p> : null}
    </div>
  );
}

function Price({ quote, ticker }: { quote: TradeQuote; ticker: string }) {
  const buy = quote.side === 'buy';
  const coin = (u: string) => `${fromBaseUnits(u, COIN_DECIMALS)} ${ticker}`;
  const sol = (u: string) => `${fromBaseUnits(u, SOL_DECIMALS)} SOL`;
  const rows: [string, string][] = [
    ['You pay', buy ? sol(quote.inAmount) : coin(quote.inAmount)],
    ['You get about', buy ? coin(quote.outAmount) : sol(quote.outAmount)],
    buy && quote.venue === 'curve' ? ['At most you pay', sol(quote.bound)] : ['At least you get', buy ? coin(quote.bound) : sol(quote.bound)],
    ['Where', quote.venue === 'curve' ? 'pump.fun curve' : 'Bonded pool, via Jupiter'],
  ];
  if (quote.priceImpactPct !== null) rows.push(['Price impact', `${(quote.priceImpactPct * 100).toFixed(2)}%`]);
  return (
    <dl className={styles['price']}>
      {rows.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}

function Outcome({ outcome }: { outcome: ConfirmOutcome }) {
  switch (outcome.kind) {
    case 'sent':
      return (
        <div className={styles['sheet']}>
          <p className={styles['done']}>Sent.</p>
          <a className={styles['link']} href={`https://solscan.io/tx/${outcome.ref}`} target="_blank" rel="noopener noreferrer">See the transaction</a>
        </div>
      );
    case 'blocked':
      return <div className={styles['sheet']}><p className={styles['note']}>Nothing was signed. {outcome.why}</p></div>;
    case 'refused':
      return <div className={styles['sheet']}><p className={styles['note']}>You declined in your wallet. Nothing was sent.</p></div>;
    case 'not-sent':
      return <div className={styles['sheet']}><p className={styles['note']}>{outcome.why}</p></div>;
    case 'unavailable':
      return <div className={styles['sheet']}><p className={styles['note']}>This wallet can't sign trades here.</p></div>;
    default:
      return <div className={styles['sheet']}><p className={styles['note']}>Something went wrong signing. Nothing was sent.</p></div>;
  }
}
