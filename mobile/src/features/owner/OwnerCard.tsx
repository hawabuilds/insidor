/**
 * The owner's strip under a For You or Popular card: "Not a meme", and the coin call when the card
 * shows a coin to call. Drawn only for the owner (the feed asks `useIsOwner`), and every tap in it
 * stays in it — none opens the post the card links to.
 */

import type { RisingPost } from '../../shared/api/index.ts';
import { CoinCallButtons } from './OwnerCoin.tsx';
import { NotAMeme } from './OwnerPost.tsx';
import { cardOf } from './owner-store.ts';
import styles from './owner.module.css';

export function OwnerCardStrip({ post }: { post: RisingPost }) {
  return (
    <div className={styles['strip']} onClick={(e) => e.stopPropagation()}>
      <NotAMeme item={{ itemId: post.id, shown: cardOf(post) }} />
      <CoinCallButtons post={post} />
    </div>
  );
}
