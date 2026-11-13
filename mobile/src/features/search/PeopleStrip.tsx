/**
 * SEARCH'S PEOPLE STRIP: the people whose handle or name matches the term, as a row of bare round
 * faces you swipe sideways, each with its @handle and a small Follow under it, as mockup B draws
 * it: no card around a face, so the row reads as people and not as more results. It sits above the narratives, posts and coins (option B, chosen
 * by the owner 13 Nov), so a search for a person shows them first without pushing the coins away.
 *
 * Separate from Search.tsx because it reads a different service (services/social, not the read
 * service) and can fail on its own: an outage here says so in one line and the rest of Search still
 * shows. An empty answer draws nothing, as an empty narrative section does.
 *
 * ★ FOLLOW IS OPTIMISTIC AND ROLLS BACK, as on a profile: the pill turns at the tap, and a refusal
 * (signed out, the service down) turns it back with a toast saying why. The face and name open the
 * profile; the pill never does.
 *
 * What breaks if changed carelessly: the strip scrolls sideways inside a page that scrolls down; a
 * card must keep its fixed width or the row stops reading as swipeable.
 */

import { useState } from 'react';

import { follow, type FoundPerson } from '../../shared/api/people.ts';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { Avatar } from '../portfolio/Avatar.tsx';
import { nameOf, profileHref } from '../following/lines.ts';
import styles from './search.module.css';

export function PeopleStrip({ people }: { people: readonly FoundPerson[] }) {
  return (
    <>
      <h2 className={styles['section']}>People</h2>
      <ul className={styles['people']} aria-label="People">
        {people.map((p) => (
          <li key={p.userId}>
            <PersonCard p={p} />
          </li>
        ))}
      </ul>
    </>
  );
}

function PersonCard({ p }: { p: FoundPerson }) {
  const toast = useToast();
  const [on, setOn] = useState(p.iFollow);
  const [followers, setFollowers] = useState(p.followers);
  const toggle = async () => {
    const next = !on;
    setOn(next);
    setFollowers((n) => n + (next ? 1 : -1));
    try {
      await follow(p.userId, next);
    } catch (e) {
      setOn(!next);
      setFollowers((n) => n - (next ? 1 : -1));
      toast(next ? "Couldn't follow" : "Couldn't unfollow", e instanceof Error ? e.message : '');
    }
  };
  return (
    <div className={styles['person']}>
      <a className={styles['personLink']} href={profileHref(p)} aria-label={`${nameOf(p)}, ${followers === 1 ? '1 follower' : `${followers} followers`}`}>
        <Avatar name={nameOf(p)} seed={p.userId} src={p.pictureUrl} file={p.pictureFile ?? null} size={56} />
        <span>{p.handle !== null ? `@${p.handle}` : nameOf(p)}</span>
      </a>
      <button type="button" className={`${styles['followPill']} ${on ? styles['on'] : ''}`} aria-pressed={on} onClick={() => void toggle()}>
        {on ? 'Following' : 'Follow'}
      </button>
    </div>
  );
}
