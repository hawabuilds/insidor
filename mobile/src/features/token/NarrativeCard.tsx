/**
 * THE NARRATIVE CARD under the token page's interval row (the owner, 2026-10-17): the coin's
 * narrative as one slim tappable row, its picture, its title on one line, "6 posts   1.3M views
 * +84K 1h" under it with the gain in green, and "Story coin" (green) or "Not checked" (grey) before
 * a small arrow. A tap opens the narrative page.
 *
 * Its own file because the page body (TokenView) only decides where it sits; which narrative and
 * what the card may say are coin-narrative.ts's, and the look is slim.module.css, shared with the
 * post card shown when there is no narrative.
 *
 * ★ THE PICTURE FALLS BACK THROUGH THE NARRATIVE'S OWN POSTS (storyPictures, shared/post-pic.ts).
 * The narrative's picture is its lead post's, and a short-video cover's signed link runs out about a
 * day after the read: on 2026-10-21 two of the four most-viewed narratives with a coin carried an
 * expired cover (403) and no stored copy, so the card showed the empty tile while their other posts'
 * pictures loaded. Our copy first, then the link, then the next posts' pictures, then the tile.
 *
 * What breaks if changed carelessly: the card is 68px on purpose. Taller, and the page no longer
 * shows two whole trades above Buy and Sell on a 390 by 844 phone, which is the point of the layout.
 */

import type { Story } from '../../shared/api/index.ts';
import { storyPictures } from '../../shared/post-pic.ts';
import { hrefFor } from '../../shared/route.ts';
import { ChevronIcon } from '../../shared/ui/icons.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { narrativeCardFacts } from './coin-narrative.ts';
import styles from './slim.module.css';

export function NarrativeCard({ story, coinAddress }: { story: Story; coinAddress: string }) {
  const f = narrativeCardFacts(story, coinAddress);
  const [pic = { url: null, file: null }, ...more] = storyPictures({ url: story.thumbUrl, file: story.thumbFile }, story.evidence.map((e) => ({ url: e.thumbUrl, file: e.thumbFile })), Date.now());
  return (
    <a className={styles['card']} href={hrefFor({ screen: 'story', storyId: story.id })} aria-label={`Open the ${f.title} narrative`}>
      <span className={styles['pic']}>
        <Thumb url={pic.url} file={pic.file} more={more} size={48} radius={12} />
      </span>
      <span className={styles['text']}>
        <b className={styles['title']}>{f.title}</b>
        <span className={styles['line']}>
          <span>{f.posts}</span>
          {f.views !== null ? <span className={styles['shrink']}>{f.views}</span> : null}
          {f.gain !== null ? <span className={f.gain.startsWith('-') ? '' : styles['up']}>{f.gain}</span> : null}
        </span>
      </span>
      <span className={styles['end']}>
        {f.coin === 'story' ? <span className={styles['story']}>Story coin</span> : <span>Not checked</span>}
        <ChevronIcon size={14} />
      </span>
    </a>
  );
}
