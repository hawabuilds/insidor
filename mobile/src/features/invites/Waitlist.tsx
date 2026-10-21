/**
 * THE WAITLIST: someone signed in without a code, who asked to be let in. Their place in line (1 is
 * next), the day they asked, and the code box, so a code that arrives later lets them straight in.
 * Drawn in the front door's own layout and wordmark (features/landing), since it stands where the
 * door stands.
 *
 * The place is a fact counted by the server when read: the people still waiting who asked first,
 * and them. It moves as people ahead are let in or bring a code; features/invites/useAccess.ts reads
 * it again every minute and whenever the app comes back to the front, and lets them in when the
 * owner does.
 *
 * What breaks if changed carelessly: nothing here decides access. Entering a code goes through the
 * same `bring` as the door, so a code works the same way in both places.
 */

import { useState } from 'react';

import { Mark } from '../landing/Landing.tsx';
import landing from '../landing/landing.module.css';
import { CodeBox, useCodeCheck } from './CodeBox.tsx';
import { cleanCode } from './invite-code.ts';
import styles from './invites.module.css';

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

export function Waitlist({ place, bring, signedInAs, signOut }: {
  readonly place: { readonly position: number; readonly joinedAt: number } | null;
  readonly bring: (code: string) => Promise<string | null>;
  readonly signedInAs: string | null;
  readonly signOut: () => void;
}) {
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = useCodeCheck(code);
  const enter = async () => {
    if (busy) return;
    const clean = cleanCode(code);
    if (clean === null) {
      setProblem('Type your invite code first.');
      return;
    }
    setBusy(true);
    setProblem(await bring(clean));
    setBusy(false);
  };
  return (
    <div className={landing['page']}>
      <div className={landing['middle']}>
        <div className={landing['brand']}>
          <Mark />
          <span className={landing['wordmark']}>INSIDOR</span>
        </div>
        <h1 className={landing['claim']}>
          You're on
          <br />
          <span className={landing['payoff']}>the waitlist</span>
        </h1>
        <p className={landing['line']}>We'll let you in as soon as there's room. Keep this page, or come back any time.</p>

        <div className={styles['place']}>
          <b>{place !== null ? `#${place.position}` : '—'}</b>
          <span>{place !== null ? `in line, since ${DAY.format(place.joinedAt)}` : 'Your place could not be read just now'}</span>
        </div>

        <p className={styles['gotCode']}>Got an invite code?</p>
        <div className={landing['actions']} style={{ marginTop: 0 }}>
          <CodeBox
            value={code}
            onChange={(v) => {
              setCode(v);
              setProblem(null);
            }}
            check={check}
            problem={problem}
          />
          <button type="button" className={landing['join']} onClick={() => void enter()}>
            {busy ? 'Checking' : 'Enter'}
          </button>
          <p className={styles['signedAs']}>
            <span>Signed in{signedInAs !== null ? ` as ${signedInAs}` : ''}</span>
            <button type="button" className={styles['textButton']} onClick={signOut}>Sign out</button>
          </p>
        </div>
      </div>
    </div>
  );
}
