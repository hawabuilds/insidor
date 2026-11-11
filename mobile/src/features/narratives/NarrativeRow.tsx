/**
 * THE NARRATIVES TAB'S SWIPEABLE ROW (the owner, 2026-11-11: "users want to doom scroll in
 * narratives"): under each narrative's title, its most viewed posts side by side, swiped sideways,
 * the way Netflix rows and Instagram carousels work. Scroll down through narratives, sideways through
 * each one's posts.
 *
 * ★ EACH POST IS THE FOR YOU CARD'S MEDIA, NOT A COPY OF IT (shared/ui/PostRow.tsx `CardMedia`): a
 * tap on a picture opens it full screen, an X video or GIF plays muted while it sits in the middle of
 * the screen (one video in the whole app at a time, FeedVideo.tsx) and a tap opens it full screen
 * with sound, a TikTok video plays in TikTok's own player. A post's views lie on its picture, bottom
 * left; the line under it is only who posted it, on which site, and when (the owner: the line was
 * "over crowded", and a post's own gain is not wanted here), drawn by the app's one head line
 * (shared/ui/HeadLine.tsx, small) so it aligns exactly as For You's does.
 *
 * ★ THE CARD OPENS NOTHING ITSELF (the owner, 2026-11-11). A narrative with more posts than its row
 * carries ends the row with "See all N posts", which opens the narrative's screen; that is the
 * tab's one way in.
 *
 * The posts come from the list itself (`Story.rowPosts`, services/read narrative-rows.ts); a card the
 * server sent none for draws no row and keeps its picture, as before.
 */

import { useRef, useState } from 'react';

import type { RowPost, Story } from '../../shared/api/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { compact } from '../../shared/format/number.ts';
import { platformOf } from '../../shared/platform.ts';
import { HeadLine } from '../../shared/ui/HeadLine.tsx';
import { ChevronIcon } from '../../shared/ui/icons.tsx';
import { CardMedia } from '../../shared/ui/PostRow.tsx';
import styles from './narrative-row.module.css';

/** A row post's media box, a little shorter than a For You card's so the narrative's next row peeks. */
const SLIDE_MEDIA_HEIGHT = 150;

export function NarrativeRow({ story, now, onSeeAll }: { story: Story; now: number; onSeeAll: () => void }) {
  const rail = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const posts = story.rowPosts;
  const total = story.postCount ?? posts.length;
  const more = total > posts.length;
  /* Which post the row rests on, for the position bar: the slide nearest the rail's left edge. */
  const onScroll = () => {
    const el = rail.current;
    const first = el?.firstElementChild as HTMLElement | null | undefined;
    if (el === null || first === null || first === undefined) return;
    setAt(Math.round(el.scrollLeft / (first.offsetWidth + 8)));
  };
  return (
    <div className={styles['row']}>
      <div ref={rail} className={styles['rail']} onScroll={onScroll}>
        {posts.map((p) => <Slide key={p.id} post={p} now={now} />)}
        {more ? (
          <button type="button" className={styles['seeAll']} onClick={onSeeAll}>
            <b>See all {total.toLocaleString('en')} posts</b>
            <ChevronIcon size={18} />
          </button>
        ) : null}
      </div>
      {posts.length + (more ? 1 : 0) > 1 ? (
        <div className={styles['position']} aria-hidden="true">
          {[...posts.map((p) => p.id), ...(more ? ['all'] : [])].map((k, i, all) => <i key={k} className={i === Math.min(at, all.length - 1) ? styles['on'] : ''} />)}
        </div>
      ) : null}
    </div>
  );
}

function Slide({ post, now }: { post: RowPost; now: number }) {
  const platform = platformOf(post.sourceLabel);
  const hasMedia = post.thumbUrl !== null || post.thumbFile !== null || post.video !== undefined;
  return (
    <article className={styles['slide']}>
      {hasMedia ? (
        <CardMedia
          post={{ id: post.id, sourceLabel: post.sourceLabel, thumbUrl: post.thumbUrl, thumbFile: post.thumbFile, thumbIsVideo: post.thumbIsVideo, ...(post.video !== undefined ? { video: post.video } : {}) }}
          height={SLIDE_MEDIA_HEIGHT}
          /* A post whose views were never read shows no number, never 0. */
          badge={post.views !== null ? <span className={styles['views']}>{compact(post.views)} views</span> : null}
        />
      ) : null}
      <div className={styles['cap']}>
        <HeadLine
          size="small"
          face={{ file: post.authorPictureFile, url: post.authorPictureUrl }}
          label={post.authorLabel}
          platform={platform}
          sourceLabel={post.sourceLabel}
          sourceLink={post.permalink}
          age={formatAge(post.postedAt, now)}
        />
        <p className={hasMedia ? styles['text'] : styles['textOnly']}>{post.excerpt}</p>
        {!hasMedia && post.views !== null ? <span className={styles['viewsLine']}>{compact(post.views)} views</span> : null}
      </div>
    </article>
  );
}
