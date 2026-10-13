/**
 * "RIGHT COIN / WRONG COIN" ON A CARD'S COIN LINE, AND PICKING THE RIGHT ONE — the owner's only.
 *
 * What is asked depends on what the card shows (owner-view.ts `coinAsk`):
 *
 *   one coin   → Right coin saves 'right' with that coin. Wrong coin saves 'wrong' at once (the
 *                owner has said it is not this one, even if they never pick) and opens the list
 *                of coins with the post's name, where "This one" saves 'wrong' again WITH the
 *                coin it is, and "No coin is from this" saves 'none'.
 *   we can't tell, with coins listed → Which coin? opens the same list; "This one" saves 'right'
 *                with that coin, "No coin is from this" saves 'none'.
 *
 * ★ A CALL IS A LABEL, NOT A LINK. Nothing here changes the coin line anyone sees, the owner
 * included: the coin-matching rules learn from these rows (internal.owner_feedback, 0054) and the
 * card changes when the matching does. The card only says what the owner said.
 *
 * The same pick list is drawn inside "See N coins" (features/feed/SameNameCoins.tsx), so the owner
 * can call it from the token list as well as from the card.
 */

import { useState } from 'react';

import { fetchPostCoins, type RisingPost, type SearchCoin } from '../../shared/api/index.ts';
import { PeopleError } from '../../shared/api/people.ts';
import { saveCall, type CoinCall } from '../../shared/api/owner.ts';
import { oneCoinLine } from '../../shared/coin-status.ts';
import { useLoad } from '../../shared/hooks.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import { useOwnerState } from './hooks.ts';
import { callKey, ownerStore } from './owner-store.ts';
import { coinAsk, coinCallLine } from './owner-view.ts';
import styles from './owner.module.css';

async function call(post: RisingPost, c: CoinCall, coin: string | null): Promise<void> {
  const line = post.coins.kind === 'one' ? oneCoinLine(post.coins.coin) : post.coins.kind;
  try {
    const saved = await saveCall({ kind: 'coin_match', itemId: post.id, call: c, coin, shown: { line, ...(post.coins.kind === 'one' ? { coinId: post.coins.coin.coinId } : {}) } });
    ownerStore.remember(saved === null ? [] : [saved]);
  } catch (e) {
    ownerStore.failed(null, e instanceof PeopleError ? e.message : 'That did not save. Try again.');
  }
}

/** The coin call under a card, when the card shows a coin to call. */
export function CoinCallButtons({ post }: { post: RisingPost }) {
  const { calls } = useOwnerState();
  const [picking, setPicking] = useState(false);
  const ask = coinAsk(post.coins);
  if (ask === null) return null;
  const said = coinCallLine(calls.get(callKey({ kind: 'coin_match', itemId: post.id })));
  const stop = (fn: () => void) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    fn();
  };
  return (
    <>
      {ask.kind === 'confirm' ? (
        <>
          <Button look="quiet" className={styles['mini']} onClick={stop(() => void call(post, 'right', ask.coin.address))}>Right coin</Button>
          <Button
            look="quiet"
            className={styles['mini']}
            onClick={stop(() => {
              void call(post, 'wrong', null);
              setPicking(true);
            })}
          >
            Wrong coin
          </Button>
        </>
      ) : (
        <Button look="quiet" className={styles['mini']} onClick={stop(() => setPicking(true))}>Which coin?</Button>
      )}
      {said !== null ? <span className={styles['saidTag']}>{said}</span> : null}
      {picking ? (
        <Modal title="Which coin is from this post?" onClose={() => setPicking(false)}>
          <CoinPickLoaded post={post} pickedCall={ask.kind === 'confirm' ? 'wrong' : 'right'} onDone={() => setPicking(false)} />
        </Modal>
      ) : null}
    </>
  );
}

function CoinPickLoaded({ post, pickedCall, onDone }: { post: RisingPost; pickedCall: CoinCall; onDone: () => void }) {
  const [loaded] = useLoad(`post-coins:${post.id}`, (signal) => fetchPostCoins(post.id, signal));
  return (
    <>
      {loaded.state === 'loading' ? <p className={styles['note']}>Loading the coins with this name.</p> : null}
      {loaded.state === 'failed' ? <p className={styles['note']}>The coins with this name could not be read just now.</p> : null}
      <CoinPickList post={post} items={loaded.state === 'ready' ? loaded.value.items : []} pickedCall={pickedCall} onDone={onDone} />
    </>
  );
}

/**
 * "This one" beside each coin, and "No coin is from this". `pickedCall` is what a pick means:
 * 'right' from a card that could not tell, 'wrong' after the owner said the card's coin is wrong.
 */
export function CoinPickList({ post, items, pickedCall, onDone }: { post: RisingPost; items: readonly SearchCoin[]; pickedCall: CoinCall; onDone?: () => void }) {
  const done = () => onDone?.();
  return (
    <div className={styles['list']}>
      {items.map((c) => (
        <div key={c.coinId} className={styles['item']}>
          <span className={styles['itemText']}>
            <p>{c.ticker !== null ? `$${c.ticker}` : (c.name ?? c.address.slice(0, 6))}</p>
            {c.name !== null ? <span className={styles['meta']}>{c.name}</span> : null}
          </span>
          <Button
            look="primary"
            onClick={() => {
              void call(post, pickedCall, c.address);
              done();
            }}
          >
            This one
          </Button>
        </div>
      ))}
      <div className={styles['item']}>
        <span className={styles['itemText']}>
          <span className={styles['meta']}>None of these, and no other coin, came from this post.</span>
        </span>
        <Button
          look="quiet"
          onClick={() => {
            void call(post, 'none', null);
            done();
          }}
        >
          No coin is from this
        </Button>
      </div>
    </div>
  );
}
