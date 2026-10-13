/**
 * The owner's strip under a For You or Popular card: "Not a meme", and the coin call when the card
 * shows a coin to call. Drawn only for the owner (the feed asks `useIsOwner`), and every tap in it
 * stays in it — none opens the post the card links to.
 *
 * One compact row, each button once (owner.module.css .cardStrip / .mini): the card is the
 * public card first, and the owner's labelling must not make it taller than one short line. What
 * the owner already said sits after the buttons as a small grey tag.
 */

import type { RisingPost } from '../../shared/api/index.ts';
import { CoinCallButtons } from './OwnerCoin.tsx';
import { NotAMeme } from './OwnerPost.tsx';
import { cardOf } from './owner-store.ts';
import styles from './owner.module.css';

export function OwnerCardStrip({ post }: { post: RisingPost }) {
  return (
    <div className={styles['cardStrip']} onClick={(e) => e.stopPropagation()}>
      <NotAMeme className={styles['mini']} item={{ itemId: post.id, shown: cardOf(post) }} />
      <CoinCallButtons post={post} />
    </div>
  );
}
