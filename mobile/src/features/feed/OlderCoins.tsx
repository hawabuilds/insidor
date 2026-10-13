/**
 * "AN OLDER COIN IS TRADING ON THIS": a line under a feed card, and the list it opens.
 *
 * Drawn under the coin line, in the card's `extra` strip (shared/ui/PostRow.tsx), only when the
 * server sent `runningOlder`: coins launched before the post, named for its subject, whose
 * trading jumped since it. One coin: the line names it, its facts sit beneath, and tapping opens
 * its token page. Several: the line counts them and "See N coins" opens the list, each row
 * opening its own token page.
 *
 * ★ NEVER A BUY HERE. An older coin is never the post's coin; the card's coin line and its
 * buttons are the server's answer about THAT, and nothing here touches them. A person who wants
 * an older coin buys it from its own page, as from Search.
 *
 * Separate from PostRow because the card is shared and its coin line is a decided rule; this is
 * a second, independent fact about the world, and keeping it in its own file means a change to
 * one cannot quietly change the other.
 */

import { useState } from 'react';
import type { OlderCoin, RisingPost } from '../../shared/api/index.ts';
import type { Millis } from '../../shared/format/measure.ts';
import { hrefFor } from '../../shared/route.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import { olderCoinId, olderCoinLabel, olderFacts, olderLine } from './older-view.ts';
import styles from './older.module.css';

const open = (c: OlderCoin) => {
  window.location.hash = hrefFor({ screen: 'token', coinId: olderCoinId(c) });
};

export function OlderCoinsLine({ post, now }: { post: RisingPost; now: Millis }) {
  const [listing, setListing] = useState(false);
  const line = olderLine(post.runningOlder);
  const only = post.runningOlder.length === 1 ? post.runningOlder[0] : undefined;
  if (line === null) return null;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <div className={styles['strip']} onClick={stop}>
      {only !== undefined ? (
        <a
          className={styles['one']}
          href={hrefFor({ screen: 'token', coinId: olderCoinId(only) })}
          onClick={stop}
        >
          <span className={styles['line']}>{line}</span>
          <span className={styles['facts']}>{olderFacts(only, now).join(', ')}</span>
        </a>
      ) : (
        <div className={styles['several']}>
          <span className={styles['line']}>{line}</span>
          <Button look="quiet" onClick={() => setListing(true)}>See {post.runningOlder.length} coins</Button>
        </div>
      )}
      {listing ? <OlderCoinsList coins={post.runningOlder} now={now} onClose={() => setListing(false)} /> : null}
    </div>
  );
}

export function OlderCoinsList({ coins, now, onClose }: { coins: readonly OlderCoin[]; now: Millis; onClose: () => void }) {
  return (
    <Modal title={`${coins.length} older coins trading since this post`} onClose={onClose}>
      <p className={styles['note']}>Launched before this post, so none of them is its coin. Busiest hour first.</p>
      <div className={styles['list']}>
        {coins.map((c) => (
          <button key={c.address} type="button" className={styles['row']} onClick={() => open(c)}>
            <span className={styles['ticker']}>{olderCoinLabel(c)}</span>
            {c.name !== null && c.ticker !== null ? <span className={styles['name']}>{c.name}</span> : null}
            <span className={styles['facts']}>{olderFacts(c, now).join(', ')}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
