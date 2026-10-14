/**
 * THE ORDER TICKET — Trador's `OrderSheet.tsx`, rebuilt in our CSS modules and purple: a centred
 * ticket with the side toggle, one big amount field, quick sizes, what you hold, what you are
 * paying, the line-by-line breakdown, one confirm, and the slippage setting behind the gear. The
 * number being typed is the thing being decided, so it sits where the eye lands and everything
 * under it is a consequence of it.
 *
 * OUR SAFETY RULES, unchanged from the partial port this replaces:
 *   - The price shown is the trade service's quote, and confirm sends that same quote back to be
 *     built (unsigned) and simulated; only a passing simulation reaches the wallet, which signs
 *     and nothing else (Privy, embedded). A failed simulation says why and nothing is signed.
 *   - The allowlist and the per-trade cap are the server's (services/trade gate.ts). The ticket
 *     reads the cap with the venue and offers no size the gate would refuse (order-flow.ts). With
 *     no cap (null, policy since 2026-10-15) any amount may be typed; one over the wallet's SOL
 *     is said under the field, and the simulation still refuses what cannot be paid.
 *   - Every outcome is said in words: sent (with the transaction), declined in the wallet,
 *     blocked by the simulation (its reason), or not taken by the network.
 *
 * Not ported from Trador: the USDC/SOL settle toggle (our trade service quotes SOL only), the
 * token transfer-fee row (a stock mint's fee; launchpad coins have none), and the "confirming
 * on-chain" wait (the trade service sends; it does not report confirmation). And there are no
 * disabled buttons: where Trador greys out Confirm, this shows why in its place.
 *
 * What breaks if changed carelessly: amounts are exact decimal strings to base units
 * (order-flow.ts `toBaseUnits`), never floats; and a quote is dropped the moment the amount,
 * side or slippage changes, so a price is never shown above a button that trades another size.
 */

import { useEffect, useMemo, useState } from 'react';

import { buildTrade, fetchHolding, fetchPortfolio, fetchTradeQuote, type TradeLimits, type TradeQuote } from '../../shared/api/index.ts';
import type { Measured } from '../../shared/format/measure.ts';
import { formatPrice } from '../../shared/format/number.ts';
import { useWallet } from '../../shared/wallet.tsx';
import { CloseIcon, GearIcon } from '../../shared/ui/icons.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import {
  SELL_STEPS,
  SLIPPAGE_CHOICES,
  buyPresets,
  confirmOrder,
  fromBase64,
  fromBaseUnits,
  impactLevel,
  sanitizeAmount,
  shareOf,
  solText,
  toBaseUnits,
  type ConfirmOutcome,
} from './order-flow.ts';
import styles from './sheet.module.css';

const SOL_DECIMALS = 9;
/** Every launchpad coin has six decimals; a held balance's own decimals win when read. */
const COIN_DECIMALS = 6;
/** Places a typed amount may carry, as Trador's field allows. */
const TYPED_PLACES = 6;
/** Typing settles for this long before a price is asked for (Trador's 600ms). */
const SETTLE_MS = 600;
/** Where the chosen slippage is remembered on this device, as Trador keeps it per browser. */
const SLIPPAGE_KEY = 'insidor.mobile.slippageBps.v1';

function readSlippage(fallback: number, max: number): number {
  try {
    const v = Number(window.localStorage.getItem(SLIPPAGE_KEY));
    return Number.isInteger(v) && v > 0 && v <= max ? v : fallback;
  } catch {
    return fallback;
  }
}

function writeSlippage(bps: number): void {
  try {
    window.localStorage.setItem(SLIPPAGE_KEY, String(bps));
  } catch {
    /* Private mode or blocked storage: the choice lasts this ticket. */
  }
}

type Quoted = { readonly kind: 'none' } | { readonly kind: 'asking' } | { readonly kind: 'quote'; readonly quote: TradeQuote } | { readonly kind: 'refused'; readonly why: string };
type Status = { readonly kind: 'idle' } | { readonly kind: 'working'; readonly line: string } | { readonly kind: 'done'; readonly outcome: ConfirmOutcome };

export function OrderSheet({ mint, ticker, side, limits, priceUsd, onClose }: {
  mint: string;
  ticker: string;
  side: 'buy' | 'sell';
  /** The gate's numbers, read with the venue; null when they could not be read (no presets then). */
  limits: TradeLimits | null;
  /** The coin's latest price, for the dollar value of a sell and the line under the field. */
  priceUsd: Measured;
  onClose: () => void;
}) {
  const { wallet, state } = useWallet();
  const account = state.kind === 'connected' ? state.account : null;
  const [activeSide, setActiveSide] = useState<'buy' | 'sell'>(side);
  const [text, setText] = useState('');
  const [slippageBps, setSlippage] = useState(() => readSlippage(limits?.defaultSlippageBps ?? 300, limits?.maxSlippageBps ?? 1_500));
  const [configOpen, setConfigOpen] = useState(false);
  const [held, setHeld] = useState<{ readonly amount: bigint; readonly decimals: number } | null | 'loading'>('loading');
  const [sol, setSol] = useState<Measured | 'loading'>('loading');
  const [quoted, setQuoted] = useState<Quoted>({ kind: 'none' });
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const buying = activeSide === 'buy';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* What the wallet holds of this coin and of SOL: a sell sizes against the first, a buy says the second. */
  useEffect(() => {
    if (account === null) return;
    const ac = new AbortController();
    fetchHolding(mint, account, ac.signal).then(
      (h) => setHeld(h === null ? null : { amount: BigInt(h.amount), decimals: h.decimals }),
      () => setHeld(null),
    );
    fetchPortfolio(account, '24h', ac.signal).then(
      (p) => setSol(p.kind === 'read' ? p.solBalance : { known: false, pending: 'unreadable' }),
      () => setSol({ known: false, pending: 'unreadable' }),
    );
    return () => ac.abort();
  }, [mint, account]);

  const heldNow = held !== 'loading' ? held : null;
  const decimals = buying ? SOL_DECIMALS : (heldNow?.decimals ?? COIN_DECIMALS);
  const amount = toBaseUnits(text, decimals);
  const overHeld = !buying && amount !== null && heldNow !== null && amount > heldNow.amount;
  const solLamports = sol !== 'loading' && sol.known ? toBaseUnits(String(sol.amount), SOL_DECIMALS) : null;
  const overSol = buying && amount !== null && solLamports !== null && amount > solLamports;

  /* A price for exactly this amount, side and slippage, asked once typing settles. */
  useEffect(() => {
    setStatus((s) => (s.kind === 'done' && s.outcome.kind === 'sent' ? s : { kind: 'idle' }));
    if (amount === null || account === null || overHeld) {
      setQuoted({ kind: 'none' });
      return;
    }
    const ac = new AbortController();
    setQuoted({ kind: 'asking' });
    const t = setTimeout(() => {
      fetchTradeQuote({ mint, side: activeSide, amount: amount.toString(), wallet: account, slippageBps }, ac.signal).then(
        (q) => setQuoted(q.kind === 'quote' ? { kind: 'quote', quote: q.quote } : { kind: 'refused', why: q.why }),
        () => {
          if (!ac.signal.aborted) setQuoted({ kind: 'refused', why: 'No price could be read just now.' });
        },
      );
    }, SETTLE_MS);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [mint, activeSide, account, slippageBps, amount?.toString(), overHeld]);

  const quote = quoted.kind === 'quote' ? quoted.quote : null;
  const impactPct = quote?.priceImpactPct == null ? null : quote.priceImpactPct * 100;
  const impact = impactLevel(impactPct);
  const presets = useMemo(() => buyPresets(limits, slippageBps), [limits, slippageBps]);
  const choices = SLIPPAGE_CHOICES.filter((b) => limits === null || b <= limits.maxSlippageBps);
  /* A coin amount for reading, with thousands grouped (Trador's `units`); the field itself keeps exact digits. */
  const coinOut = (units: string) => {
    const exact = fromBaseUnits(units, heldNow?.decimals ?? COIN_DECIMALS);
    const n = Number(exact);
    return n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : exact;
  };
  const sent = status.kind === 'done' && status.outcome.kind === 'sent' ? status.outcome.ref : null;

  const reset = (next: () => void) => {
    next();
    setQuoted({ kind: 'none' });
    setStatus({ kind: 'idle' });
  };

  const confirm = async (q: TradeQuote) => {
    if (wallet === null || account === null) return;
    setStatus({ kind: 'working', line: 'Checking the trade' });
    try {
      const outcome = await confirmOrder(q, {
        build: async (x) => {
          const built = await buildTrade(x, account);
          if (built.kind === 'ready') setStatus({ kind: 'working', line: 'Waiting for your signature' });
          return built;
        },
        signAndSend: (p) => wallet.signAndSendTransaction(p),
        decode: fromBase64,
      });
      setStatus({ kind: 'done', outcome });
    } catch {
      setStatus({ kind: 'done', outcome: { kind: 'failed' } });
    }
  };

  /* Why there is no confirm right now, in the order that is most useful to say (Trador's order). */
  const blockReason: string | null =
    account === null
      ? null
      : amount === null
        ? text.trim() === '' ? 'Enter an amount' : 'That is not an amount'
        : overHeld
          ? `You hold ${heldNow === null ? '' : coinOut(heldNow.amount.toString())} ${ticker}`
          : overSol
            ? null
            : quoted.kind === 'asking'
              ? 'Getting a price'
              : quoted.kind === 'refused'
                ? quoted.why
                : impact === 'block' && impactPct !== null
                  ? `Price impact is ${Math.abs(impactPct).toFixed(1)}%, too high to place.`
                  : null;

  const payLine = amount === null
    ? `— ${buying ? 'SOL' : ticker}`
    : buying ? `${solText(amount)} SOL` : `${fromBaseUnits(amount.toString(), decimals)} ${ticker}`;
  const sellUsd = !buying && amount !== null && priceUsd.known ? Number(fromBaseUnits(amount.toString(), decimals)) * priceUsd.amount : null;

  return (
    <div className={styles['scrim']} onClick={onClose}>
      <div className={styles['ticket']} role="dialog" aria-modal="true" aria-label={`${buying ? 'Buy' : 'Sell'} ${ticker}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles['close']} onClick={onClose} aria-label="Close"><CloseIcon size={15} /></button>

        <div className={styles['head']}>
          <h2>{buying ? 'Buy' : 'Sell'} {ticker}</h2>
          <button type="button" className={configOpen ? styles['gearOn'] : styles['gear']} aria-expanded={configOpen} aria-label="Order settings" onClick={() => setConfigOpen((o) => !o)}>
            <GearIcon size={17} />
          </button>
        </div>

        {configOpen ? (
          <div className={styles['config']}>
            <div className={styles['configHead']}>
              <span className={styles['label']}>Max slippage</span>
              <button type="button" onClick={() => setConfigOpen(false)}>Done</button>
            </div>
            <div className={styles['choices']}>
              {choices.map((bps) => (
                <button key={bps} type="button" aria-pressed={bps === slippageBps} className={bps === slippageBps ? styles['choiceOn'] : ''} onClick={() => reset(() => {
                  setSlippage(bps);
                  writeSlippage(bps);
                })}>
                  {bps / 100}%
                </button>
              ))}
            </div>
            <p className={styles['configNote']}>The trade fails rather than fills beyond this. Higher tolerance fills more often and at a worse price.</p>
          </div>
        ) : null}

        <div className={styles['sides']}>
          {(['buy', 'sell'] as const).map((o) => (
            <button key={o} type="button" aria-pressed={o === activeSide} className={o === activeSide ? (o === 'buy' ? styles['sideBuy'] : styles['sideSell']) : ''} onClick={() => reset(() => {
              setActiveSide(o);
              setText('');
            })}>
              {o === 'buy' ? 'Buy' : 'Sell'}
            </button>
          ))}
        </div>

        {account === null ? (
          <div className={styles['signIn']}>
            <p>Sign in to trade. Your wallet is created for you; Insidor never holds its key.</p>
            {wallet !== null && state.kind !== 'unavailable' && state.kind !== 'connecting' ? (
              <button type="button" className={styles['confirm']} onClick={() => void wallet.connect()}>Sign in</button>
            ) : null}
          </div>
        ) : (
          <>
            <label htmlFor="order-amount" className={styles['sr']}>Amount in {buying ? 'SOL' : ticker}</label>
            <div className={styles['field']}>
              <span className={styles['label']}>Amount</span>
              <div className={styles['inputRow']}>
                <input
                  id="order-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={text}
                  onChange={(e) => reset(() => setText(sanitizeAmount(e.target.value, Math.min(TYPED_PLACES, decimals))))}
                />
                <span className={styles['unit']}>{buying ? 'SOL' : ticker}</span>
              </div>
              <div className={styles['estimate']}>
                {quote !== null ? (
                  `≈ ${buying ? `${coinOut(quote.outAmount)} ${ticker}` : `${solText(BigInt(quote.outAmount))} SOL`}`
                ) : quoted.kind === 'asking' ? (
                  'Finding a price'
                ) : (
                  <><Value r={formatPrice(priceUsd)} /> per {ticker}</>
                )}
              </div>
            </div>

            <div className={styles['quick']}>
              {buying
                ? presets.map((p) => (
                    <button key={p.label} type="button" onClick={() => reset(() => setText(fromBaseUnits(p.lamports.toString(), SOL_DECIMALS)))}>{p.label}</button>
                  ))
                : heldNow !== null && heldNow.amount > 0n
                  ? SELL_STEPS.map((step) => (
                      <button key={step} type="button" onClick={() => reset(() => setText(fromBaseUnits(shareOf(heldNow.amount, step).toString(), heldNow.decimals)))}>{step}%</button>
                    ))
                  : null}
            </div>

            <div className={styles['holdLine']}>
              <span>{buying ? 'Available' : 'You hold'}</span>
              <b className={overHeld || overSol ? styles['error'] : ''}>
                {buying
                  ? sol === 'loading' ? 'Reading' : sol.known ? `${Number(sol.amount.toFixed(4))} SOL` : "Couldn't read balance"
                  : held === 'loading' ? 'Reading' : heldNow === null ? "Couldn't read balance" : `${coinOut(heldNow.amount.toString())} ${ticker}`}
              </b>
            </div>

            <div className={styles['paying']}>
              <span>{buying ? 'Paying with' : 'Selling'}</span>
              <b>
                {payLine}
                {sellUsd !== null && sellUsd > 0 ? `  $${sellUsd.toFixed(2)}` : ''}
              </b>
            </div>

            {quote !== null ? (
              <div className={styles['lines']}>
                <Line label={`Insidor fee (${(limits?.feeBps ?? 0) / 100}%)`}>{limits === null ? '—' : limits.feeBps === 0 ? 'Not taken' : `${limits.feeBps / 100}% of the trade`}</Line>
                <Line label="Price impact" tone={impact === 'ok' ? null : impact === 'caution' ? 'caution' : 'error'}>
                  {impactPct === null ? '—' : `${Math.abs(impactPct).toFixed(2)}%`}
                </Line>
                {buying && quote.venue === 'curve' ? (
                  <Line label="Most you pay">{solText(BigInt(quote.bound))} SOL</Line>
                ) : (
                  <Line label="Minimum received">{buying ? `${coinOut(quote.bound)} ${ticker}` : `${solText(BigInt(quote.bound))} SOL`}</Line>
                )}
                <Line label="Route">{quote.venue === 'curve' ? 'pump.fun curve' : 'Bonded pool, via Jupiter'}</Line>
                <Line label="Max slippage">{slippageBps / 100}%</Line>
              </div>
            ) : null}

            {impact === 'warn' && impactPct !== null ? <p role="alert" className={styles['error']}>Price impact is {Math.abs(impactPct).toFixed(1)}%. You would receive materially less than the quoted price.</p> : null}
            {impact === 'caution' && impactPct !== null ? <p role="alert" className={styles['caution']}>Price impact is {Math.abs(impactPct).toFixed(1)}%. This pool is thin, so you pay more than the price shown.</p> : null}

            {overSol && sol !== 'loading' && sol.known ? (
              <div className={styles['short']}>
                <b>Not enough SOL</b>
                <span>You have {Number(sol.amount.toFixed(4))} SOL</span>
              </div>
            ) : null}

            {status.kind === 'done' ? <OutcomeLine outcome={status.outcome} /> : null}

            {sent !== null ? (
              <button type="button" className={styles['confirm']} onClick={onClose}>Done</button>
            ) : status.kind === 'working' ? (
              <div className={styles['confirmWait']} role="status">{status.line}</div>
            ) : quote !== null && blockReason === null && !overSol ? (
              <button type="button" className={styles['confirm']} onClick={() => void confirm(quote)}>{buying ? 'Buy' : 'Sell'} {ticker}</button>
            ) : (
              <div className={styles['confirmWait']}>{blockReason ?? (overSol ? 'Not enough SOL' : `${buying ? 'Buy' : 'Sell'} ${ticker}`)}</div>
            )}

            <p className={styles['foot']}>Max slippage {slippageBps / 100}%&nbsp;&nbsp;&nbsp;One signature, no approval step</p>
          </>
        )}
      </div>
    </div>
  );
}

function Line({ label, tone = null, children }: { label: string; tone?: 'error' | 'caution' | null; children: React.ReactNode }) {
  return (
    <div className={styles['line']}>
      <span>{label}</span>
      <b className={tone === 'error' ? styles['error'] : tone === 'caution' ? styles['caution'] : ''}>{children}</b>
    </div>
  );
}

/** Every outcome in words: what happened, and whether anything was signed or sent. */
function OutcomeLine({ outcome }: { outcome: ConfirmOutcome }) {
  switch (outcome.kind) {
    case 'sent':
      return (
        <p role="status" className={styles['success']}>
          Sent. <a href={`https://solscan.io/tx/${outcome.ref}`} target="_blank" rel="noopener noreferrer">View transaction</a>
        </p>
      );
    case 'blocked':
      return <p role="alert" className={styles['error']}>Nothing was signed. {outcome.why}</p>;
    case 'refused':
      return <p role="alert" className={styles['error']}>You cancelled the signature. Nothing was sent.</p>;
    case 'not-sent':
      return <p role="alert" className={styles['error']}>{outcome.why}</p>;
    case 'unavailable':
      return <p role="alert" className={styles['error']}>This wallet can't sign trades here.</p>;
    default:
      return <p role="alert" className={styles['error']}>Something went wrong signing. Nothing was sent.</p>;
  }
}
