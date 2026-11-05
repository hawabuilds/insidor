/**
 * THE VIRAL POST CARD under the token page's chart, shown only when the coin has no narrative
 * (NarrativeCard.tsx is shown when it has one): the most-viewed feed post that names this coin, as
 * one slim tappable row the narrative card's size (slim.module.css, the owner 2026-10-17): its
 * picture with the site's badge, the post's text on one bold line, and under it its views and what
 * is known about the coin and the post. Tapping it opens the post sheet (features/post-sheet).
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
import styles from './slim.module.css';

export function ViralPost({ posts, launchedAt = null }: { posts: readonly AboutPost[]; launchedAt?: number | null }) {
  const [open, setOpen] = useState(false);
  const viral = viralPost(posts, { launchedAt });
  if (viral === null) return null;
  const { post, proven } = viral;
  /* The two sites the feed shows, whose marks are white on black; any other site keeps its name only. */
  const site = platformOf(post.sourceLabel);
  const platform = site === 'x' || site === 'tiktok' ? site : null;
  return (
    <>
      <button type="button" className={styles['card']} onClick={() => setOpen(true)} aria-label="Open the viral post with this name">
        {/* A post with no picture has no picture box (the owner, 2026-11-05), as on the narratives. */}
        {post.thumbUrl !== null ? (
          <span className={styles['pic']}>
            <Thumb url={post.thumbUrl} size={48} radius={12} hideEmpty />
            {platform !== null ? (
              <span className={styles['badge']} title={post.sourceLabel} aria-label={post.sourceLabel}>
                <PlatformMark platform={platform} size={10} />
              </span>
            ) : null}
          </span>
        ) : null}
        <span className={styles['text']}>
          <b className={styles['title']}>{post.excerpt !== '' ? post.excerpt : 'Viral post with this name'}</b>
          <span className={styles['line']}>
            {post.views.known ? <span><Value r={formatCount(post.views)} /> views</span> : null}
            {proven ? <span className={styles['story']}>Links this post</span> : <span>Not proven as the origin</span>}
          </span>
        </span>
        <span className={styles['end']}>
          <ChevronIcon size={14} />
        </span>
      </button>
      {open ? <PostSheet postId={post.postId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
