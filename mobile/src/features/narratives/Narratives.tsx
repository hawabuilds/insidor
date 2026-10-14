/**
 * NARRATIVES — viral posts grouped by the story they are about.
 *
 * The board's stories as whole pages (`GET /narratives/default`), in the board's order, under
 * the same notice the feed shows: nothing for observed stories, a label for any story the server
 * says was written by hand. Each row opens the story's real page.
 *
 * Rows are the feed's row with the posts count in place of a handle, and no platform badge on
 * the picture — a narrative spans several sites, and one badge would name one of them. Each
 * byline starts with the narrative's stage (Early, Forming, Big), the server's name for how many
 * posts it lists and how far its top post has been seen.
 */

import { useState } from 'react';
import { BOARD_VIEW, fetchNarratives, type Story } from '../../shared/api/index.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { boardNotice } from '../../shared/notice.ts';
import { hrefFor } from '../../shared/route.ts';
import { useComingSoon } from '../../shared/ui/ComingSoon.tsx';
import { FilterIcon } from '../../shared/ui/icons.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { StoryRow } from '../../shared/ui/StoryRow.tsx';
import { orderNarratives, postsLine, stageLabel, type NarrativeOrder } from './narrative-order.ts';
import styles from './narratives.module.css';
import { tickerText } from '../../shared/format/ticker.ts';

export function Narratives({ onCreate }: { onCreate: (story: Story) => void }) {
  const [order, setOrder] = useState<NarrativeOrder>('popular');
  const [list] = useLoad('narratives', (signal) => fetchNarratives(BOARD_VIEW, signal));
  const now = useNow();
  const soon = useComingSoon();
  const open = (s: Story) => (window.location.hash = hrefFor({ screen: 'story', storyId: s.id }));

  return (
    <section className={styles['screen']}>
      <header className={styles['header']}>
        <h1>Narratives</h1>
        <p>Viral posts grouped by the story they're about</p>
      </header>

      <div className={styles['controls']}>
        <button type="button" className={styles['filter']} aria-label="Filters" onClick={() => soon('Filtering narratives')}>
          <FilterIcon size={18} />
        </button>
        <div className={styles['segments']} role="tablist" aria-label="Order">
          {(['new', 'popular'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={order === k}
              className={`${styles['segment']} ${order === k ? styles['segmentOn'] : ''}`}
              onClick={() => setOrder(k)}
            >
              {k === 'new' ? 'New' : 'Popular'}
            </button>
          ))}
        </div>
      </div>

      <Notice notice={list.state === 'ready' ? boardNotice(list.value.provenance) : null} />

      {list.state === 'loading' ? <p className={styles['empty']}>Loading.</p> : null}
      {list.state === 'failed' ? <p className={styles['empty']}>Couldn't load the narratives.</p> : null}
      {list.state === 'ready' && list.value.stories.length === 0 ? <p className={styles['empty']}>No narratives yet.</p> : null}
      {list.state === 'ready'
        ? orderNarratives(list.value.stories, order).map((s) => (
            <StoryRow
              key={s.id}
              item={s}
              now={now}
              byline={
                <span>
                  {stageLabel(s) === null ? null : <span className={`${styles['stage']} ${styles[`stage_${s.stage ?? ''}`] ?? ''}`}>{stageLabel(s)}</span>}
                  {postsLine(s)}
                </span>
              }
              platform={null}
              platformLabel=""
              handlers={{
                open: () => open(s),
                viewCoins: () => open(s),
                create: () => onCreate(s),
                buy: (ticker) => soon(`Buying ${tickerText(ticker)}`),
              }}
            />
          ))
        : null}
    </section>
  );
}
