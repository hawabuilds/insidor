/**
 * "SECOND CHANCES" — the For You posts that came in after a "no", because our own model was sure
 * they would be coined. The owner's only, opened from the feed beside "Hidden by me", so the owner
 * can check each one (the owner, 2026-10-18).
 *
 * ★ NOTHING ON A CARD SAYS SO. Other people see these posts like any other; this list is the only
 * place the route is shown, and it shows no number — only which posts, when, and a link.
 *
 * ★ "NOT A MEME" STILL WORKS ON THEM. A post here is an ordinary For You post: the owner's tap on its
 * card hides it, and teaches the next fit.
 *
 * What breaks if changed carelessly: the server's list is the record (services/social owner.ts
 * `safety-net`); an empty list while the model is in its shadow is the truth, not a failure.
 */

import { fetchSecondChance, type SecondChancePost } from '../../shared/api/owner.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import styles from './owner.module.css';

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;

function shownAgo(atMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - atMs) / MS_PER_MINUTE));
  if (minutes < 1) return 'On For You just now';
  if (minutes < MINUTES_PER_HOUR) return `On For You ${minutes}m ago`;
  return `On For You ${Math.floor(minutes / MINUTES_PER_HOUR)}h ago`;
}

export function SecondChance({ onClose }: { onClose: () => void }) {
  const [loaded, reload] = useLoad('owner:second-chance', () => fetchSecondChance());
  const now = useNow();
  const posts = loaded.state === 'ready' ? loaded.value : null;
  return (
    <Modal title="Second chances" subtitle="For You posts that came in after a no, in the last two days" onClose={onClose}>
      {loaded.state === 'loading' ? <p className={styles['note']}>Loading.</p> : null}
      {loaded.state === 'failed' ? (
        <>
          <p className={styles['note']}>The list could not be read just now. This is not an empty list.</p>
          <Button look="quiet" onClick={reload}>Try again</Button>
        </>
      ) : null}
      {posts !== null && posts.length === 0 ? <p className={styles['note']}>No post has come in this way.</p> : null}
      {posts !== null && posts.length > 0 ? (
        <div className={styles['list']}>
          {posts.map((p) => (
            <Row key={p.itemId} post={p} now={now} />
          ))}
        </div>
      ) : null}
    </Modal>
  );
}

function Row({ post, now }: { post: SecondChancePost; now: number }) {
  const text = post.text !== null && post.text.trim() !== '' ? post.text : 'A post with no words';
  return (
    <div className={styles['item']}>
      <span className={styles['itemText']}>
        {post.link !== null ? (
          <a href={post.link} target="_blank" rel="noopener noreferrer">{text}</a>
        ) : (
          <p>{text}</p>
        )}
        <span className={styles['meta']}>{shownAgo(post.at, now)}</span>
      </span>
    </div>
  );
}
