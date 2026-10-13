/**
 * THE POST SHEET — one feed post, opened from its For You card or from a coin page's viral post
 * card: who posted it, the post itself (its video plays here), its views and how they grew, and
 * the post's main coin with Buy, Create and the full coin list (Choose coin).
 *
 * Its own feature folder because two screens open it (features/feed and features/token), and
 * neither should own the other's sheet. The props are the contract the token page builds on
 * (scratchpad post-sheet-contract.md): `postId` is the feed post's id (`RisingPost.id`, the
 * same id `AboutPost.postId` carries) and `onClose` puts the screen back as it was.
 *
 * What breaks if changed carelessly: renaming or adding a required prop breaks the token page,
 * which renders this sheet without knowing anything else about the post.
 */

import { useEffect } from 'react';
import styles from './post-sheet.module.css';

export interface PostSheetProps {
  /** The feed post's id: `RisingPost.id`, or `AboutPost.postId` on a coin page. */
  readonly postId: string;
  readonly onClose: () => void;
}

export function PostSheet({ postId, onClose }: PostSheetProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={styles['scrim']} onClick={onClose}>
      <div className={styles['sheet']} role="dialog" aria-modal="true" aria-label="Post" data-post={postId} onClick={(e) => e.stopPropagation()}>
        <span className={styles['grip']} aria-hidden="true" />
      </div>
    </div>
  );
}
