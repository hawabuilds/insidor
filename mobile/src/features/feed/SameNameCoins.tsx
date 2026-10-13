/**
 * "SEE 3 COINS": the coins an unsure For You post shares its name with, in a modal over the feed.
 *
 * Opened from the post card (shared/ui/PostRow.tsx) and read from `GET /post/:id/coins`. Each
 * coin is drawn as Search draws it (features/search/Search.tsx `CoinRow`): picture, ticker,
 * "On curve x%" or "Bonded", launch age and market cap, and tapping one opens its token page,
 * where Buy and Sell are offered as for any coin opened from Search.
 *
 * ★ STRONGEST EVIDENCE FIRST, BY DEFAULT: the server's order (links this post, same picture,
 * launched after it in time, then the earliest launch), each coin with the facts that held
 * beneath it ("Links this post", "Same picture", "Launched 12m after"). The list never re-ranks
 * them itself. Earliest and market cap are a tap away; a coin we cannot place sorts last,
 * never as zero.
 *
 * ★ THE TITLE COUNTS THE LIST SHOWN, not the card's number. The two are written together and
 * should agree; if they ever do not, the sheet says what is in front of the person. When the
 * search found more coins than it kept, it says these are the newest of them.
 *
 * Create is here too, prefilled from the post exactly as the card's own Create button: the
 * person may decide none of these is the coin they meant.
 */

import { useState } from 'react';
import { ReadError, fetchPostCoins, type RisingPost, type SameNameCoin } from '../../shared/api/index.ts';
import { evidenceFacts } from '../../shared/coin-status.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import { CoinRow } from '../search/Search.tsx';
import { orderCoins, type CoinOrder } from '../search/search-view.ts';
import searchStyles from '../search/search.module.css';
import { sameNameTitle } from './same-name-view.ts';
import { useIsOwner } from '../owner/hooks.ts';
import { CoinPickList } from '../owner/OwnerCoin.tsx';
import { coinAsk } from '../owner/owner-view.ts';
import styles from './same-name.module.css';

export function SameNameCoins({ post, onCreate, onClose }: { post: RisingPost; onCreate: () => void; onClose: () => void }) {
  const [loaded] = useLoad(`post-coins:${post.id}`, (signal) => fetchPostCoins(post.id, signal));
  const [order, setOrder] = useState<CoinOrder | 'evidence'>('evidence');
  const now = useNow();
  const owner = useIsOwner();
  const list = loaded.state === 'ready' ? loaded.value : null;
  const shown: readonly SameNameCoin[] = list === null ? [] : order === 'evidence' ? list.items : (orderCoins(list.items, order) as readonly SameNameCoin[]);
  const facts = (c: SameNameCoin): readonly string[] => (c.evidence === null ? [] : evidenceFacts(c.evidence));

  return (
    <Modal title={list === null ? 'Coins with this name' : sameNameTitle(list.items.length, list.more)} onClose={onClose}>
      {loaded.state === 'loading' ? <p className={styles['note']}>Loading.</p> : null}
      {loaded.state === 'failed' ? (
        <p className={styles['note']}>
          {loaded.error instanceof ReadError && loaded.error.said === 'not found'
            ? 'This post has changed since the feed was read. Close this and the feed will show it as it is now.'
            : loaded.error instanceof ReadError && loaded.error.said === 'slow down'
              ? 'Too many lists at once. Wait a minute and try again.'
              : 'These coins could not be read just now.'}
        </p>
      ) : null}
      {list !== null ? (
        <>
          <div className={styles['bar']}>
            <p className={styles['note']}>We can't tell which one came from this post.</p>
            {list.items.length > 1 ? (
              <div className={searchStyles['order']} role="group" aria-label="Order coins by">
                <button type="button" aria-pressed={order === 'evidence'} className={order === 'evidence' ? searchStyles['on'] : ''} onClick={() => setOrder('evidence')}>Evidence</button>
                <button type="button" aria-pressed={order === 'first'} className={order === 'first' ? searchStyles['on'] : ''} onClick={() => setOrder('first')}>Earliest</button>
                <button type="button" aria-pressed={order === 'cap'} className={order === 'cap' ? searchStyles['on'] : ''} onClick={() => setOrder('cap')}>Market cap</button>
              </div>
            ) : null}
          </div>
          {list.more ? <p className={styles['note']}>More coins use this name; these are the newest.</p> : null}
          {list.sourcesMissing > 0 ? <p className={styles['note']}>A market could not be read, so some numbers are missing.</p> : null}
          {list.items.length === 0 ? <p className={styles['note']}>None of these coins can be listed right now.</p> : null}
          <div className={styles['list']}>
            {shown.map((c) => (
              <div key={c.coinId}>
                <CoinRow c={c} now={now} />
                {facts(c).length > 0 ? <p className={styles['facts']}>{facts(c).join(', ')}</p> : null}
              </div>
            ))}
          </div>
          {/* The owner's call on which coin this post's is (features/owner/OwnerCoin.tsx). */}
          {owner ? (
            <>
              <p className={styles['note']}>Which one is from this post?</p>
              <CoinPickList post={post} items={shown} pickedCall={coinAsk(post.coins)?.kind === 'confirm' ? 'wrong' : 'right'} onDone={onClose} />
            </>
          ) : null}
        </>
      ) : null}
      <div className={styles['create']}>
        <Button look="primary" onClick={onCreate}>Create coin</Button>
      </div>
    </Modal>
  );
}
