/**
 * The discussion on a story.
 *
 * Deliberately thin: chronological, no reply trees, no vote counts, no ordering the client
 * can influence. A discussion with a score attached would be a second ranked surface, and
 * this product already has one whose ranking is the thing being sold.
 *
 * Posting is unimplemented — it needs an authenticated identity, and this package has no
 * auth yet. The composer is here so the shape is settled, and it says plainly that it does
 * not work rather than failing silently on submit.
 */

import { useState } from 'react';

import type { DiscussionPost } from '../../shared/api/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { Button, Card, Num } from '../../shared/ui/index.ts';
import styles from './story.module.css';

export function Discussion({ posts, now }: { posts: readonly DiscussionPost[]; now: number }) {
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <Card title={`Discussion · ${posts.length}`}>
      {posts.length === 0 ? (
        <div className={styles['loading']}>nobody has said anything yet</div>
      ) : (
        posts.map((post) => (
          <div key={post.postId} className={styles['post']}>
            <div className={styles['postMeta']}>
              <span>{post.authorLabel}</span>
              <Num rendered={formatAge(post.postedAt, now)} dim />
            </div>
            <div className={styles['postText']}>{post.text}</div>
          </div>
        ))
      )}

      <div className={styles['composer']}>
        <input
          className={styles['composerInput']}
          value={draft}
          placeholder="say something"
          aria-label="write a message"
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button onClick={() => setNotice('posting needs an account, which does not exist yet')}>
          Post
        </Button>
      </div>
      {notice === null ? null : <div className={styles['statLabel']}>{notice}</div>}
    </Card>
  );
}
