/**
 * THE "TWITTER WORLD WAR" CARD AND ITS SHEET (the owner, 2026-10-23): every online meme war between
 * countries that is still being posted, under one card in the Narratives tab (world-war.ts says
 * where it stands and how the fights are gathered).
 *
 *   the card    the umbrella's name, a picture of each fight's first narrative, one line per fight
 *               with its narratives and posts ("France vs Japan   15 posts"), the total, and on
 *               Trending the viral posts' accounts it is listed by. ★ It reads every meme war from the
 *               server, as the sheet does (the same read, shared): on 24 Oct the card counted only the
 *               wars the list had loaded and said "1 narrative" while its sheet showed two
 *   the sheet   opened by a tap: one section per fight, each narrative as a row (picture, title, its
 *               posts and age, as the tab's cards say them); a row opens that narrative's page. It
 *               reads every meme war from the server (GET /narratives/:view/fights), not only the
 *               ones the list has loaded, and shows the loaded ones until that answer is in
 *
 * Facts only, as every card: which countries the server said, and counts a reader can check.
 *
 * Its own file so the feature can be found, and removed, in one place.
 */

import { useState } from 'react';

import { BOARD_VIEW, fetchFightNarratives, type Story } from '../../shared/api/index.ts';
import { useLoad } from '../../shared/hooks.ts';
import { hrefFor } from '../../shared/route.ts';
import { ChevronIcon } from '../../shared/ui/icons.tsx';
import { Sheet, SheetBody, SheetHead } from '../../shared/ui/Sheet.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { cardLine, realNarratives, viralLine } from './narrative-order.ts';
import { WAR_TITLE, fightSections } from './world-war.ts';
import styles from './narratives.module.css';

/** Every meme war from the server, shared by the card and its sheet; the list's loaded ones until it is in. */
function useFights(loaded: readonly Story[]): { readonly stories: readonly Story[]; readonly failed: boolean } {
  const [all] = useLoad('narratives:fights', (signal) => fetchFightNarratives(BOARD_VIEW, signal), 'memory');
  return { stories: all.state === 'ready' ? realNarratives(all.value.stories) : loaded, failed: all.state === 'failed' };
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
const postsOf = (list: readonly Story[]): number => list.reduce((sum, s) => sum + (s.postCount ?? s.evidence.length), 0);

/** The umbrella card, in the list where its first meme war stood; a tap opens the sheet. */
export function WarCard({ stories, place, now, trending = false }: { stories: readonly Story[]; place: number | null; now: number; trending?: boolean }) {
  const [open, setOpen] = useState(false);
  const all = useFights(stories);
  const fights = fightSections(all.stories);
  const shown = fights.flatMap((f) => f.stories);
  const viral = trending ? viralLine(shown) : null;
  return (
    <>
      <article className={styles['card']} role="button" tabIndex={0} onClick={() => setOpen(true)} onKeyDown={(e) => {
        if (e.key === 'Enter') setOpen(true);
      }}>
        <div className={styles['top']}>
          {place !== null ? <span className={styles['place']}>{place}</span> : null}
          <span className={styles['warThumbs']}>
            {fights.slice(0, 3).map((f) => (
              <Thumb key={f.name} url={f.stories[0]?.thumbUrl ?? null} file={f.stories[0]?.thumbFile ?? null} size={fights.length > 1 ? 44 : 64} radius={fights.length > 1 ? 12 : 16} />
            ))}
          </span>
          <div className={styles['text']}>
            <b className={styles['title']}>{WAR_TITLE}</b>
            {fights.map((f) => (
              <span key={f.name} className={styles['warFight']}>
                <b>{f.name}</b>
                {f.stories.length > 1 ? <span>{plural(f.stories.length, 'narrative')}</span> : null}
                <span>{plural(postsOf(f.stories), 'post')}</span>
              </span>
            ))}
            <span className={styles['sub']}>
              <span>{plural(shown.length, 'narrative')}</span>
              <span>{plural(postsOf(shown), 'post')}</span>
            </span>
            {viral !== null ? <span className={`${styles['speed']} ${styles['up']}`}>{viral}</span> : null}
          </div>
          <ChevronIcon size={20} />
        </div>
      </article>
      {open ? <WarSheet loaded={stories} now={now} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function WarSheet({ loaded, now, onClose }: { loaded: readonly Story[]; now: number; onClose: () => void }) {
  const all = useFights(loaded);
  const sections = fightSections(all.stories);
  const go = (s: Story) => {
    onClose();
    window.location.hash = hrefFor({ screen: 'story', storyId: s.id });
  };
  return (
    <Sheet label={WAR_TITLE} onClose={onClose}>
      <SheetHead title={WAR_TITLE} />
      <SheetBody last>
        {all.failed ? <p className={styles['warNote']}>Couldn't load every fight; showing the ones in the list.</p> : null}
        {sections.length === 0 ? <p className={styles['warNote']}>No country is fighting right now.</p> : null}
        {sections.map((f) => (
          <section key={f.name} className={styles['warSection']}>
            <h3 className={styles['warName']}>{f.name}</h3>
            {f.stories.map((s) => (
              <button key={s.id} type="button" className={styles['warRow']} onClick={() => go(s)}>
                <Thumb url={s.thumbUrl} file={s.thumbFile} size={44} radius={12} />
                <span className={styles['text']}>
                  <b className={styles['warRowTitle']}>{s.title}</b>
                  <span className={styles['sub']}>
                    {cardLine(s, now).map((w) => <span key={w}>{w}</span>)}
                  </span>
                </span>
                <ChevronIcon size={18} />
              </button>
            ))}
          </section>
        ))}
      </SheetBody>
    </Sheet>
  );
}
