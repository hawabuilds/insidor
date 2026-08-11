/**
 * THE BUY PANEL.
 *
 * Its props take a `BuyAction` — the branch of the row-action union that carries a
 * confirmed, tradable coin. An unsure match is a different type and cannot be passed here,
 * which is the whole point of that union: this panel does not check whether the coin is
 * settled, because it cannot be constructed for one that is not.
 *
 * The cost breakdown renders `quote.costs` as an array. There is no fee line in this file
 * and nowhere to put one: measured all-in cost ranged 1.60% to 22.72% across three same-age
 * mints, so any hardcoded "0.50% fee" would be a lie on most trades. If the array is empty,
 * the panel says the costs are unknown rather than implying they are zero.
 */

import { useCallback, useEffect, useState } from 'react';

import type { BuyAction } from '../feed/index.ts';
import { fetchQuote, submitTrade } from '../../shared/api/index.ts';
import type { TradeResult } from '../../shared/api/index.ts';
import { formatBps, formatPrice, formatUsd } from '../../shared/format/number.ts';
import { formatCountdown } from '../../shared/format/duration.ts';
import { Button, Num } from '../../shared/ui/index.ts';
import type { LiveQuote, QuoteState } from './quote-state.ts';
import { settle } from './quote-state.ts';
import styles from './trade.module.css';

/** The chain's smallest unit for the currency being spent. Nine decimals. */
const UNITS_PER_WHOLE = 1_000_000_000;
/** Re-check expiry roughly as often as the countdown changes. */
const TICK_MS = 1_000;

function toRawUnits(text: string): string | null {
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return String(Math.round(parsed * UNITS_PER_WHOLE));
}

export interface TradePanelProps {
  readonly action: BuyAction;
  readonly onClose: () => void;
}

export function TradePanel({ action, onClose }: TradePanelProps) {
  const { coin } = action;
  const [amount, setAmount] = useState('0.1');
  const [state, setState] = useState<QuoteState>({ kind: 'idle' });
  const [result, setResult] = useState<TradeResult | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  /* Expiry is derived, never stored as a boolean that can go stale. */
  useEffect(() => {
    setState((current) => settle(current, now));
  }, [now]);

  const requestQuote = useCallback(() => {
    const raw = toRawUnits(amount);
    if (raw === null) {
      setState({ kind: 'failed', message: 'enter an amount' });
      return;
    }
    setState({ kind: 'requesting' });
    /* Never cached and never reused across a render: the venue changes the moment a coin
       graduates off its bonding curve, so a held quote can be for the wrong pool entirely. */
    fetchQuote(coin.coinId, raw)
      .then((quote) => setState({ kind: 'live', quote }))
      .catch((e: unknown) =>
        setState({ kind: 'failed', message: e instanceof Error ? e.message : 'quote unavailable' }),
      );
  }, [amount, coin.coinId]);

  const confirm = useCallback(
    (live: LiveQuote) => {
      submitTrade({
        quoteId: live.quote.quoteId,
        coinId: coin.coinId,
        acceptedAt: Date.now(),
      })
        .then(setResult)
        .catch((e: unknown) =>
          setResult({ kind: 'rejected', message: e instanceof Error ? e.message : 'rejected' }),
        );
    },
    [coin.coinId],
  );

  return (
    <div className={styles['panel']}>
      <div className={styles['head']}>
        <div>
          <div className={styles['ticker']}>{coin.ticker}</div>
          <div className={styles['name']}>
            {coin.name} · {coin.venueLabel}
          </div>
          <div className={styles['address']}>
            {coin.address.slice(0, 6)}…{coin.address.slice(-4)}
          </div>
        </div>
      </div>

      <div>
        <div className={styles['costLine']}>
          <span>price</span>
          <Num rendered={formatPrice(coin.priceUsd)} />
        </div>
        <div className={styles['costLine']}>
          <span>market cap{coin.marketCapBasis ? ` (${coin.marketCapBasis})` : ''}</span>
          <Num rendered={formatUsd(coin.marketCapUsd)} />
        </div>
        <div className={styles['costLine']}>
          <span>liquidity</span>
          {/* Absent on a bonding curve. Absence is not illiquidity, so it shows as pending
              with its reason rather than as $0. */}
          <Num rendered={formatUsd(coin.liquidityUsd)} showWord />
        </div>
      </div>

      <div className={styles['amountRow']}>
        <input
          className={styles['amountInput']}
          inputMode="decimal"
          value={amount}
          aria-label="amount to spend"
          onChange={(e) => setAmount(e.target.value)}
        />
        <Button onClick={requestQuote}>Quote</Button>
      </div>

      {state.kind === 'requesting' ? <div className={styles['receiveLabel']}>quoting…</div> : null}

      {state.kind === 'unquotable' ? (
        <div className={styles['error']}>
          no quote available for this coin — it cannot be bought right now
        </div>
      ) : null}

      {state.kind === 'failed' ? (
        /* Distinct wording from unquotable on purpose: this is us, not the market. */
        <div className={styles['error']}>could not get a quote: {state.message}</div>
      ) : null}

      {state.kind === 'expired' ? (
        <div className={styles['expired']}>
          this quote expired.{' '}
          <button type="button" className={styles['requote']} onClick={requestQuote}>
            re-quote
          </button>
        </div>
      ) : null}

      {state.kind === 'live' ? (
        <>
          <div className={styles['receive']}>
            <span className={styles['receiveLabel']}>you receive</span>
            <span className={styles['receiveValue']}>{state.quote.outExpectedDisplay}</span>
          </div>

          <div className={styles['costs']}>
            {state.quote.costs.length === 0 ? (
              <div className={styles['costLine']}>
                <span>costs</span>
                <span className={styles['refundable']}>not itemised — do not assume zero</span>
              </div>
            ) : (
              state.quote.costs.map((cost) => (
                <div key={cost.code} className={styles['costLine']}>
                  <span className={styles['costLabel']}>
                    {cost.label}
                    {cost.refundable ? (
                      <span className={styles['refundable']}>refundable</span>
                    ) : null}
                  </span>
                  <Num rendered={formatUsd(cost.amountUsd)} />
                </div>
              ))
            )}
            <div className={styles['allIn']}>
              <span>all-in</span>
              <Num rendered={formatBps(state.quote.allInBps)} />
            </div>
            <div className={styles['costLine']}>
              <span>price impact</span>
              <Num rendered={formatBps(state.quote.priceImpactBps)} />
            </div>
            <div className={styles['route']}>
              via {state.quote.route.map((leg) => leg.label).join(' → ') || 'unknown route'}
            </div>
            <div className={styles['expiry']}>
              expires in <Num rendered={formatCountdown(state.quote.expiresAt, now)} dim />
            </div>
          </div>

          {/* The confirm path takes the live branch, so an expired quote cannot reach it. */}
          <Button tone="primary" onClick={() => confirm(state)}>
            Confirm buy
          </Button>
        </>
      ) : null}

      {result === null ? null : (
        <div className={result.kind === 'rejected' ? styles['error'] : styles['receiveLabel']}>
          {/* submitted is not filled, and the copy says so. */}
          {result.kind === 'submitted' ? `submitted — ${result.reference}` : null}
          {result.kind === 'filled' ? `filled — ${result.reference}` : null}
          {result.kind === 'rejected' ? `rejected: ${result.message}` : null}
          {result.kind === 'expired' ? 'the quote expired before it landed' : null}
        </div>
      )}

      <Button tone="quiet" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}
