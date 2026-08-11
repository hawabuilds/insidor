/**
 * THE COINS minted from this story.
 *
 * One meme can spawn hundreds of tokens, so this panel's real job is the `unsure` case: when
 * we are not confident which coin is the one, the panel says so, says how many candidates
 * there are, and offers no way to buy. That is not a degraded state to be styled around —
 * on this product it is a frequent and honest answer, and it gets real estate.
 *
 * The buy affordance is decided per coin by `actionFor`, the same function the feed row
 * uses, so the two surfaces cannot drift apart on when a coin may be bought.
 */

import type { CoinLink, Coin } from '../../shared/api/index.ts';
import type { BuyAction } from '../feed/index.ts';
import { actionFor, actionLabel } from '../feed/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { formatPrice, formatUsd } from '../../shared/format/number.ts';
import { Button, Card, Num } from '../../shared/ui/index.ts';
import styles from './story.module.css';

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
      <div className={styles['coinHead']}>
        <span className={styles['coinTicker']}>{coin.ticker}</span>
        {action.kind === 'buy' ? (
          <Button tone="primary" onClick={() => onBuy(action)}>
            {actionLabel(action)}
          </Button>
        ) : (
          /* No disabled button here either. The reason is text. */
          <span className={styles['statLabel']}>not tradable yet</span>
        )}
      </div>
      <div className={styles['coinGrid']}>
        <div className={styles['coinCell']}>
          <span className={styles['statLabel']}>price</span>
          <Num rendered={formatPrice(coin.priceUsd)} />
        </div>
        <div className={styles['coinCell']}>
          <span className={styles['statLabel']}>
            cap{coin.marketCapBasis === 'fully-diluted' ? ' (fd)' : ''}
          </span>
          <Num rendered={formatUsd(coin.marketCapUsd)} />
        </div>
        <div className={styles['coinCell']}>
          <span className={styles['statLabel']}>age</span>
          {/* Mint time we could not confirm shows as pending, never as a fresh mint. */}
          <Num rendered={formatAge(coin.mintedAt, now)} dim />
        </div>
      </div>
      <div className={styles['statLabel']}>
        {coin.name} · {coin.venueLabel}
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
        <Card title="Coins">
          <div className={styles['unsure']}>
            Nothing has been minted from this story yet.
          </div>
        </Card>
      );

    case 'unsure':
      return (
        <Card title="Coins">
          <div className={styles['unsure']}>
            <span className={styles['unsureCount']}>{coins.candidateCount}</span> coins claim this
            story and none of them is settled yet. We are not naming one, so there is nothing to
            buy here — this panel will fill in when it is.
          </div>
        </Card>
      );

    case 'one':
      return (
        <Card title="Coin">
          <CoinCard storyId={storyId} coin={coins.coin} now={now} onBuy={onBuy} />
        </Card>
      );

    case 'several':
      return (
        <Card title={`Coins · ${coins.coins.length}`}>
          {coins.coins.map((coin) => (
            <CoinCard key={coin.coinId} storyId={storyId} coin={coin} now={now} onBuy={onBuy} />
          ))}
        </Card>
      );
  }
}
