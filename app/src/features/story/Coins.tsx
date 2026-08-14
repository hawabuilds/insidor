/**
 * THE COINS minted from this story — Hawa's `.secbox` side panel (styles/index.css:470,
 * 507-512), sticky beside the chart column exactly as her trade box is.
 *
 * One meme can spawn hundreds of tokens, so this panel's real job is the `unsure` case: when
 * we are not confident which coin is the one, the panel says so, says how many coins claim
 * the story, and offers no way to buy. That is not a degraded state to be styled around —
 * on this product it is a frequent and honest answer, and it gets real estate.
 *
 * ★ RULE 3, AND WHERE IT IS ENFORCED. The `unsure` branch of `CoinLink` carries no coin, so
 * this file cannot render a buy control for it even by mistake: there is no coin to put in a
 * `BuyAction`, and `Button` has no `disabled` prop to reach for. The unsure branch below
 * renders prose. It is the only branch that renders no `<CoinCard>` at all, which is what
 * makes "no buy affordance anywhere on the page, at any depth" a property of the types rather
 * than a thing someone remembered.
 *
 * The buy affordance is decided per coin by `actionFor`, the same function the feed row
 * uses, so the two surfaces cannot drift apart on when a coin may be bought.
 */

import { useEffect, useState } from 'react';

import type { CoinLink, Coin } from '../../shared/api/index.ts';
import type { BuyAction } from '../feed/index.ts';
import { actionFor, actionLabel } from '../feed/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { formatPrice, formatUsd } from '../../shared/format/number.ts';
import { Button, Num } from '../../shared/ui/index.ts';
import styles from './story.module.css';

/** How long her `.ca-mini.copied` lime flash stays up. */
const COPIED_MS = 1_200;

/**
 * Her contract chip (index.css:279-283), truncated 6…4 and copying on click.
 *
 * Styled as something pressable because it genuinely is — this is one of the few controls on
 * the page with real behaviour behind it. Where the clipboard is unavailable (an insecure
 * context, a browser that refuses) the chip stays as it was rather than flashing a success it
 * did not have.
 */
function ContractChip({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = (): void => {
    const clip = globalThis.navigator?.clipboard;
    if (clip === undefined) return;
    clip.writeText(address).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <button
      type="button"
      className={`${styles['caMini']} ${copied ? styles['caMiniCopied'] : ''}`}
      onClick={copy}
      title={address}
      aria-label={`copy contract address ${address}`}
    >
      {copied ? 'copied' : `${address.slice(0, 6)}…${address.slice(-4)}`}
    </button>
  );
}

function CoinCard({
  storyId,
  coin,
  now,
  onBuy,
}: {
  storyId: string;
  coin: Coin;
  now: number;
  onBuy: (action: BuyAction) => void;
}) {
  const action = actionFor(storyId, { kind: 'one', coin });
  return (
    <div className={styles['coin']}>
      <div className={styles['coinTop']}>
        <span className={styles['coinTicker']}>${coin.ticker}</span>
        <span className={styles['coinName']}>{coin.name}</span>
      </div>

      <div className={styles['coinSub']}>
        <ContractChip address={coin.address} />
        <span className={styles['chip']}>{coin.venueLabel}</span>
      </div>

      {/* Her `.mini` recap well. Every figure comes through a formatter that returns a dash
          for an absence — there is no branch in any of them that produces a zero. */}
      <div className={styles['mini']}>
        <div className={styles['miniRow']}>
          <span className={styles['miniK']}>price</span>
          <Num rendered={formatPrice(coin.priceUsd)} showWord />
        </div>
        <div className={styles['miniRow']}>
          <span className={styles['miniK']}>
            market cap{coin.marketCapBasis === null ? '' : ` (${coin.marketCapBasis})`}
          </span>
          <Num rendered={formatUsd(coin.marketCapUsd)} showWord />
        </div>
        <div className={styles['miniRow']}>
          {/* Absent on a bonding curve. Absence is not illiquidity, so it shows as pending
              with its reason rather than as $0. */}
          <span className={styles['miniK']}>liquidity</span>
          <Num rendered={formatUsd(coin.liquidityUsd)} showWord />
        </div>
        <div className={styles['miniRow']}>
          {/* A mint time we could not confirm shows as pending, never as a fresh mint. */}
          <span className={styles['miniK']}>minted</span>
          <Num rendered={formatAge(coin.mintedAt, now)} dim />
        </div>
      </div>

      <div className={styles['coinActs']}>
        {action.kind === 'buy' ? (
          <Button tone="primary" onClick={() => onBuy(action)}>
            {actionLabel(action)}
          </Button>
        ) : (
          /* No disabled button here either. The reason is text — and it is the server's
             `tradable`, which it decides by trying to get a quote, not ours to override. */
          <span className={styles['noBuy']}>
            not tradable — no venue will quote this coin right now
          </span>
        )}
      </div>
    </div>
  );
}

export function Coins({
  storyId,
  coins,
  now,
  onBuy,
}: {
  storyId: string;
  coins: CoinLink;
  now: number;
  onBuy: (action: BuyAction) => void;
}) {
  switch (coins.kind) {
    case 'none':
      return (
        <section className={`${styles['panel']} ${styles['secbox']}`}>
          <div className={styles['secH']}>Coin</div>
          <div className={styles['unsure']}>
            Nothing has been minted from this story yet.
            {/* No "Create" control: nothing in this build can mint a coin, and a button that
                cannot do the thing it names is the disabled button one step later. */}
          </div>
        </section>
      );

    case 'unsure':
      return (
        <section className={`${styles['panel']} ${styles['secbox']}`}>
          <div className={styles['secH']}>Coin</div>
          <div className={styles['unsure']}>
            <span className={styles['unsureCount']}>{coins.claimCount}</span> coins claim this
            story and none of them is settled. We are not naming one, so there is nothing here
            to buy — and no greyed-out button to wait on. This panel fills in if one settles.
          </div>
        </section>
      );

    case 'one':
      return (
        <section className={`${styles['panel']} ${styles['secbox']}`}>
          <div className={styles['secH']}>Coin</div>
          <CoinCard storyId={storyId} coin={coins.coin} now={now} onBuy={onBuy} />
        </section>
      );

    case 'several':
      return (
        <section className={`${styles['panel']} ${styles['secbox']}`}>
          <div className={styles['secH']}>
            Coins
            <span className={styles['secCount']}>{coins.coins.length}</span>
          </div>
          {coins.coins.map((coin) => (
            <CoinCard key={coin.coinId} storyId={storyId} coin={coin} now={now} onBuy={onBuy} />
          ))}
        </section>
      );
  }
}
