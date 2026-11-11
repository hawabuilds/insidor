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
 * "over crowded", and a post's own gain is not wanted here). Spacing separates them, no dots: the
 * app's one dot is the For You head line's (screen-rules.test.ts).
 *
 * ★ A TAP ANYWHERE BUT THE MEDIA OPENS THE NARRATIVE, as a tap on the card always did: the media
 * stops its own tap, so watching a video never navigates away.
 *
 * The posts come from the list itself (`Story.rowPosts`, services/read narrative-rows.ts); a card the
 * server sent none for draws no row and keeps its picture, as before.
 */

import { useRef, useState } from 'react';

import type { RowPost, Story } from '../../shared/api/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { compact } from '../../shared/format/number.ts';
import { platformOf } from '../../shared/platform.ts';
import { CardMedia } from '../../shared/ui/PostRow.tsx';
import { PlatformMark } from '../../shared/ui/PlatformMark.tsx';
import { usePosterPic } from '../../shared/ui/usePosterPic.ts';
import { Value } from '../../shared/ui/Value.tsx';
import styles from './narrative-row.module.css';

/** A row post's media box, a little shorter than a For You card's so the narrative's next row peeks. */
const SLIDE_MEDIA_HEIGHT = 150;

export function NarrativeRow({ story, now }: { story: Story; now: number }) {
  const rail = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const posts = story.rowPosts;
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
      </div>
      {posts.length > 1 ? (
        <div className={styles['position']} aria-hidden="true">
          {posts.map((p, i) => <i key={p.id} className={i === Math.min(at, posts.length - 1) ? styles['on'] : ''} />)}
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
        <div className={styles['who']}>
          <Face file={post.authorPictureFile} url={post.authorPictureUrl} label={post.authorLabel} />
          <b className={styles['handle']}>{post.authorLabel}</b>
          {platform !== null ? <span className={styles['mark']}><PlatformMark platform={platform} size={14} /></span> : null}
          <Value r={formatAge(post.postedAt, now)} className={styles['age']} />
        </div>
        <p className={hasMedia ? styles['text'] : styles['textOnly']}>{post.excerpt}</p>
        {!hasMedia && post.views !== null ? <span className={styles['viewsLine']}>{compact(post.views)} views</span> : null}
      </div>
    </article>
  );
}

/** The poster's own picture beside the handle (the owner's rule: every @handle has its face); the first letter only when none loads. */
function Face({ file, url, label }: { file: string | null; url: string | null; label: string }) {
  const { src, tryKey, onError } = usePosterPic(file, url);
  if (src !== null) return <img key={tryKey} className={styles['face']} src={src} alt="" loading="lazy" onError={onError} />;
  return <span className={styles['faceLetter']} aria-hidden="true">{(label.replace(/^@/, '').trim()[0] ?? '?').toUpperCase()}</span>;
}
