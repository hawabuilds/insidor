/**
 * THE STORY PAGE — evidence, coins, discussion.
 *
 * This is the page that has to be honest, because it is where a user decides whether to
 * believe the board. Three things follow from that and none of them is styling:
 *
 *   - The header shows facts and one already-made judgement (`momentum`, a three-valued
 *     enum). There is no number here the client could threshold.
 *   - Absences render as absences. A story whose start time we do not know says so; it does
 *     not borrow the moment we first saw it and call that the beginning.
 *   - The buy affordance appears here through the same function the feed row uses, so the
 *     two surfaces cannot disagree about when a coin may be bought.
 *
 * Fetch-on-mount rather than a router loader: there is one route parameter and no
 * server-side rendering, so a loader would be indirection with nothing to hide.
 */

import { useEffect, useState } from 'react';

import type { Story as StoryData } from '../../shared/api/index.ts';
import { fetchStory } from '../../shared/api/index.ts';
import type { BuyAction } from '../feed/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { formatCount } from '../../shared/format/number.ts';
import { Card, Delta, Num, Sparkline, Thumb } from '../../shared/ui/index.ts';
import { Coins } from './Coins.tsx';
import { Discussion } from './Discussion.tsx';
import { EvidenceList } from './Evidence.tsx';
import styles from './story.module.css';

const CLOCK_MS = 1_000;

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly story: StoryData }
  | { readonly kind: 'failed'; readonly message: string };

export interface StoryProps {
  readonly storyId: string;
  readonly onBuy: (action: BuyAction) => void;
  readonly isWatched: boolean;
  readonly onToggleWatch: (storyId: string) => void;
}

export function Story({ storyId, onBuy, isWatched, onToggleWatch }: StoryProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setLoad({ kind: 'loading' });
    fetchStory(storyId, ac.signal)
      .then((story) => setLoad({ kind: 'ready', story }))
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setLoad({ kind: 'failed', message: e instanceof Error ? e.message : 'could not load' });
      });
    return () => ac.abort();
  }, [storyId]);

  if (load.kind === 'loading') return <div className={styles['loading']}>loading story…</div>;
  if (load.kind === 'failed') return <div className={styles['loading']}>{load.message}</div>;

  const { story } = load;

  return (
    <div className={styles['page']}>
      <div className={styles['column']}>
        <Card>
          <div className={styles['header']}>
            <Thumb url={story.thumbUrl} alt={story.title} />
            <div>
              <h1 className={styles['title']}>{story.title}</h1>
              <p className={styles['summary']}>
                {story.summary[0]} {story.summary[1]}
              </p>
              <div className={styles['stats']}>
                <div className={styles['stat']}>
                  <span className={styles['statLabel']}>views</span>
                  <Num rendered={formatCount(story.reach)} showWord />
                </div>
                <div className={styles['stat']}>
                  <span className={styles['statLabel']}>24h</span>
                  {/* Coloured by sign only. The magnitude never picks the colour. */}
                  <Delta value={story.reachDelta24h} />
                </div>
                <div className={styles['stat']}>
                  <span className={styles['statLabel']}>age</span>
                  <Num rendered={formatAge(story.firstSeenAt, now)} showWord />
                </div>
                <div className={styles['stat']}>
                  <span className={styles['statLabel']}>activity</span>
                  <Sparkline
                    points={story.spark.points}
                    windowMs={story.spark.windowMs}
                    tone={story.momentum}
                    label={`activity for ${story.title}`}
                  />
                </div>
                <div className={styles['stat']}>
                  <span className={styles['statLabel']}>watch</span>
                  <button
                    type="button"
                    className={styles['composerInput']}
                    onClick={() => onToggleWatch(story.id)}
                  >
                    {isWatched ? 'watching' : 'watch'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <EvidenceList items={story.evidence} now={now} />
        <Discussion posts={story.discussion} now={now} />
      </div>

      <div className={styles['column']}>
        <Coins storyId={story.id} coins={story.coins} now={now} onBuy={onBuy} />
      </div>
    </div>
  );
}
