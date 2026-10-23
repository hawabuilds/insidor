/**
 * THE "TWITTER WORLD WAR" CARD AND ITS SHEET (the owner, 2026-10-23): every online meme war between
 * countries that is still being posted, under one card in the Narratives tab (world-war.ts says
 * where it stands and how the fights are gathered).
 *
 *   the card    the umbrella's name, the fights it holds ("China vs Turkey, France vs Japan"), how
 *               many narratives, and the picture of the first of them
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
import { cardLine, realNarratives } from './narrative-order.ts';
import { WAR_TITLE, fightSections } from './world-war.ts';
import styles from './narratives.module.css';

/** The umbrella card, in the list where its first meme war stood; a tap opens the sheet. */
export function WarCard({ stories, place, now }: { stories: readonly Story[]; place: number | null; now: number }) {
  const [open, setOpen] = useState(false);
  const fights = fightSections(stories);
  const first = stories[0] ?? null;
  const n = stories.length;
  return (
    <>
      <article className={styles['card']} role="button" tabIndex={0} onClick={() => setOpen(true)} onKeyDown={(e) => {
        if (e.key === 'Enter') setOpen(true);
      }}>
        <div className={styles['top']}>
          {place !== null ? <span className={styles['place']}>{place}</span> : null}
          <Thumb url={first?.thumbUrl ?? null} file={first?.thumbFile ?? null} size={64} radius={16} />
          <div className={styles['text']}>
            <b className={styles['title']}>{WAR_TITLE}</b>
            <span className={styles['warFights']}>{fights.map((f) => f.name).join(', ')}</span>
            <span className={styles['sub']}>
              <span>{`${n} narrative${n === 1 ? '' : 's'}`}</span>
            </span>
          </div>
          <ChevronIcon size={20} />
        </div>
      </article>
      {open ? <WarSheet loaded={stories} now={now} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function WarSheet({ loaded, now, onClose }: { loaded: readonly Story[]; now: number; onClose: () => void }) {
  const [all] = useLoad('narratives:fights', (signal) => fetchFightNarratives(BOARD_VIEW, signal));
  const stories = all.state === 'ready' ? realNarratives(all.value.stories) : loaded;
  const sections = fightSections(stories);
  const go = (s: Story) => {
    onClose();
    window.location.hash = hrefFor({ screen: 'story', storyId: s.id });
  };
  return (
    <Sheet label={WAR_TITLE} onClose={onClose}>
      <SheetHead title={WAR_TITLE} />
      <SheetBody last>
        {all.state === 'failed' ? <p className={styles['warNote']}>Couldn't load every fight; showing the ones in the list.</p> : null}
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
