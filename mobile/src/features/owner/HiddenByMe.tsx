/**
 * "HIDDEN BY ME" — the posts whose current call is "Not a meme", newest first, each with "Is a
 * meme" to bring it back. The owner's only, opened from the feed.
 *
 * ★ THE OWNER MUST BE ABLE TO SEE WHAT THEY HID. A hidden post is on no feed, so this list is the
 * only way back to it. It is drawn from the card the owner saw when hiding it (saved beside the
 * call), because the projection no longer carries the post.
 *
 * ★ ONE TAP BRINGS IT BACK. "Is a meme" is saved as a call with its date, and the post leaves this
 * list at once; it returns to the feeds on the projector's next run if it clears their views bar.
 */

import { useState } from 'react';

import { fetchHidden, type HiddenPost } from '../../shared/api/owner.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { showPost } from './OwnerPost.tsx';
import { hiddenAgo } from './owner-view.ts';
import styles from './owner.module.css';

export function HiddenByMe({ onClose }: { onClose: () => void }) {
  const [loaded, reload] = useLoad('owner:hidden', () => fetchHidden());
  const [back, setBack] = useState<ReadonlySet<string>>(new Set());
  const now = useNow();
  const posts = loaded.state === 'ready' ? loaded.value.filter((p) => !back.has(p.itemId)) : null;
  return (
    <Modal title="Hidden by me" subtitle="Posts you marked Not a meme" onClose={onClose}>
      {loaded.state === 'loading' ? <p className={styles['note']}>Loading.</p> : null}
      {loaded.state === 'failed' ? (
        <>
          <p className={styles['note']}>The list could not be read just now. This is not an empty list.</p>
          <Button look="quiet" onClick={reload}>Try again</Button>
        </>
      ) : null}
      {posts !== null && posts.length === 0 ? <p className={styles['note']}>You haven't hidden any posts.</p> : null}
      {posts !== null && posts.length > 0 ? (
        <div className={styles['list']}>
          {posts.map((p) => (
            <Hidden key={p.itemId} post={p} now={now} onBack={() => setBack((s) => new Set([...s, p.itemId]))} />
          ))}
        </div>
      ) : null}
    </Modal>
  );
}

function Hidden({ post, now, onBack }: { post: HiddenPost; now: number; onBack: () => void }) {
  const c = post.card;
  const text = c.excerpt ?? 'A post with no words saved';
  return (
    <div className={styles['item']}>
      <Thumb url={c.thumbUrl} size={44} />
      <span className={styles['itemText']}>
        {c.permalink !== null ? (
          <a href={c.permalink} target="_blank" rel="noopener noreferrer">{text}</a>
        ) : (
          <p>{text}</p>
        )}
        <span className={styles['meta']}>
          {[c.authorLabel, c.sourceLabel, hiddenAgo(post.at, now)].filter((x) => x !== null).join(', ')}
          {post.note !== null ? `. Why: ${post.note}` : ''}
        </span>
      </span>
      <Button
        look="primary"
        onClick={() => {
          void showPost(post.itemId).then((ok) => {
            if (ok) onBack();
          });
        }}
      >
        Is a meme
      </Button>
    </div>
  );
}
