/**
 * THE VIRAL POST CARD under the token page's chart: the most-viewed feed post that names this
 * coin, as one tappable row: its picture with the site's badge (smaller than the list rows' badge,
 * so it marks the picture rather than covering it), "Viral post with this name" and
 * the narrative it is on, the post's text on one line, and its views beside what is known about
 * the coin and the post. Tapping it opens the post sheet (features/post-sheet).
 *
 * Its own file because the page body (TokenView) only decides where it sits; what it says, and
 * that it says nothing more than the facts, lives here and in viral-post.ts.
 *
 * ★ PROVEN OR NOT, NEVER IN BETWEEN. "Links this post" only when the post's evidence says so;
 * otherwise "not proven as the origin". A coin sharing a viral post's name is not that post's
 * coin, and the card must not let the views read as if it were.
 * ★ NO POST, NO CARD. A coin no feed post names has nothing here, not an empty box; a part of
 * the post we do not have (its picture, its views, its narrative) is left out, not zeroed.
 *
 * What breaks if changed carelessly: the post id handed to the sheet is the feed post's id from
 * the About read (`AboutPost.postId`); anything else opens a sheet that cannot find its post.
 */

import { useState } from 'react';

import type { AboutPost } from '../../shared/api/index.ts';
import { formatCount } from '../../shared/format/number.ts';
import { platformOf } from '../../shared/platform.ts';
import { ChevronIcon } from '../../shared/ui/icons.tsx';
import { PlatformMark } from '../../shared/ui/PlatformMark.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { PostSheet } from '../post-sheet/index.ts';
import { viralPost } from './viral-post.ts';
import styles from './viral.module.css';

export function ViralPost({ posts }: { posts: readonly AboutPost[] }) {
  const [open, setOpen] = useState(false);
  const viral = viralPost(posts);
  if (viral === null) return null;
  const { post, proven } = viral;
  /* The two sites the feed shows, whose marks are white on black; any other site keeps its name only. */
  const site = platformOf(post.sourceLabel);
  const platform = site === 'x' || site === 'tiktok' ? site : null;
  return (
    <>
      <button type="button" className={styles['card']} onClick={() => setOpen(true)} aria-label="Open the viral post with this name">
        <span className={styles['pic']}>
          <Thumb url={post.thumbUrl} size={48} radius={12} />
          {platform !== null ? (
            <span className={styles['badge']} title={post.sourceLabel} aria-label={post.sourceLabel}>
              <PlatformMark platform={platform} size={10} />
            </span>
          ) : null}
        </span>
        <span className={styles['text']}>
          <span className={styles['line']}>
            <span className={styles['fixed']}>Viral post with this name</span>
            {post.story !== null ? <span className={styles['story']}>{post.story.title} narrative</span> : null}
          </span>
          {post.excerpt !== '' ? <span className={styles['excerpt']}>{post.excerpt}</span> : null}
          <span className={styles['line']}>
            {post.views.known ? <span className={styles['fixed']}><Value r={formatCount(post.views)} /> views</span> : null}
            {proven ? <span className={styles['proven']}>Links this post</span> : <span>not proven as the origin</span>}
          </span>
        </span>
        <ChevronIcon size={16} />
      </button>
      {open ? <PostSheet postId={post.postId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
