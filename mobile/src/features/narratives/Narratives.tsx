/**
 * NARRATIVES — viral posts grouped by the story they are about.
 *
 * ★ SAMPLE DATA, AND IT SAYS SO, PERMANENTLY. There is no read route for a list of narratives
 * yet, so this screen is the dev fixtures' `nr_` stories, decoded through the same decoder as
 * the network, under a "Sample data" bar that nothing can switch off. In a production build
 * the screen does not render the list at all (`SAMPLE_SCREENS`); it says the feature is coming.
 *
 * Rows are the feed's row with the posts count in place of a handle, and no platform badge on
 * the picture — a narrative spans several sites, and one badge would name one of them.
 */

import { useState } from 'react';
import { SAMPLE_SCREENS, loadSampleNarratives, type Story } from '../../shared/api/index.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { SAMPLE_SCREEN } from '../../shared/notice.ts';
import { hrefFor } from '../../shared/route.ts';
import { useComingSoon } from '../../shared/ui/ComingSoon.tsx';
import { FilterIcon } from '../../shared/ui/icons.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { StoryRow } from '../../shared/ui/StoryRow.tsx';
import { ComingSoonScreen } from '../soon/ComingSoonScreen.tsx';
import { orderNarratives, postsLine, type NarrativeOrder } from './narrative-order.ts';
import styles from './narratives.module.css';

export function Narratives({ onCreate }: { onCreate: (story: Story) => void }) {
  if (!SAMPLE_SCREENS) return <ComingSoonScreen which="narratives" />;
  return <SampleNarratives onCreate={onCreate} />;
}

function SampleNarratives({ onCreate }: { onCreate: (story: Story) => void }) {
  const [order, setOrder] = useState<NarrativeOrder>('popular');
  const [list] = useLoad('narratives', () => loadSampleNarratives());
  const now = useNow();
  const soon = useComingSoon();
  const open = (s: Story) => (window.location.hash = hrefFor({ screen: 'story', storyId: s.id, sample: true }));

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

      <Notice notice={SAMPLE_SCREEN} />

      {list.state === 'loading' ? <p className={styles['empty']}>Loading.</p> : null}
      {list.state === 'failed' ? <p className={styles['empty']}>Couldn't load the sample narratives.</p> : null}
      {list.state === 'ready'
        ? orderNarratives(list.value, order).map((s) => (
            <StoryRow
              key={s.id}
              item={s}
              now={now}
              byline={<span>{postsLine(s)}</span>}
              platform={null}
              platformLabel=""
              handlers={{
                open: () => open(s),
                viewCoins: () => open(s),
                create: () => onCreate(s),
                buy: (ticker) => soon(`Buying $${ticker}`),
              }}
            />
          ))
        : null}
    </section>
  );
}
