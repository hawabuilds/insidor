/**
 * The discussion on a story.
 *
 * Deliberately thin: chronological, no reply trees, no vote counts, no ordering the client
 * can influence. A discussion with a score attached would be a second ranked surface, and
 * this product already has one whose ranking is the thing being sold.
 *
 * ★ THERE IS NO DISCUSSION TABLE. The projector sends an empty list, always
 * (services/project/src/project.ts:697-700), because nothing stores posts and nothing
 * authenticates a person to write one.
 *
 * So the composer is gone. It used to render an input and a Post button that set a notice
 * string when pressed — a form that looks like it works, does not, and only admits it after
 * you have typed into it. That is the same failure as a disabled button one step later:
 * it invites the user to invest in something that cannot happen. What is here instead is one
 * sentence saying what would have to exist. The rendering path for real posts is kept and
 * styled, so the day the table lands this file needs no design work.
 */

import type { DiscussionPost } from '../../shared/api/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { Num } from '../../shared/ui/index.ts';
import styles from './story.module.css';

export function Discussion({ posts, now }: { posts: readonly DiscussionPost[]; now: number }) {
  if (posts.length === 0) {
    return (
      <div className={styles['empty']}>
        <b>Nobody has said anything here.</b>
        Nobody can, yet: there is nothing storing messages and no way to sign in as anyone. So
        there is no box to type into — it would not send.
        <span className={styles['emptyNote']}>needs: accounts, and somewhere to put a post</span>
      </div>
    );
  }

  return (
    <div>
      {posts.map((post) => (
        <div key={post.postId} className={styles['post']}>
          <div className={styles['postMeta']}>
            <span className={styles['postWho']}>{post.authorLabel}</span>
            <Num rendered={formatAge(post.postedAt, now)} dim />
          </div>
          <div className={styles['postText']}>{post.text}</div>
        </div>
      ))}
    </div>
  );
}
